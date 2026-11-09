package drop

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"html/template"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	pageCSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: blob: https:; frame-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
	appCSP  = "sandbox allow-scripts allow-popups allow-downloads; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"
)

//go:embed templates/*.html static/*
var assets embed.FS

var pages = template.Must(template.ParseFS(assets, "templates/*.html"))

type Nav struct {
	Nit  string
	Pero string
	Term string
	Drop string
}

type Handler struct {
	store     *Store
	guard     func(*http.Request) bool
	log       *slog.Logger
	maxUpload int64
	links     Nav
	now       func() time.Time
}

func NewHandler(store *Store, guard func(*http.Request) bool, log *slog.Logger, links Nav) http.Handler {
	if log == nil {
		log = slog.Default()
	}
	h := &Handler{
		store:     store,
		guard:     guard,
		log:       log,
		maxUpload: maxUploadBytes(),
		links:     links,
		now:       time.Now,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /drop/{$}", h.index)
	mux.HandleFunc("GET /drop", h.redirectIndex)
	mux.HandleFunc("GET /drop/e/{id}", h.redirectEntry)
	mux.HandleFunc("GET /drop/e/{id}/{$}", h.entry)
	mux.HandleFunc("GET /drop/files/{id}", h.redirectFiles)
	mux.HandleFunc("GET /drop/files/{id}/{path...}", h.file)
	mux.HandleFunc("GET /drop/download/{id}/{path...}", h.download)
	mux.HandleFunc("GET /drop/static/{name}", h.static)
	mux.HandleFunc("POST /drop/api/upload", h.upload)
	mux.HandleFunc("POST /drop/api/delete", h.delete)
	return h.headers(mux)
}

func (h *Handler) headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

type indexPage struct {
	Nav      Nav
	Entries  []entryCard
	Max      string
	Error    string
	NowLabel string
}

type entryCard struct {
	Entry       Entry
	URL         string
	Kind        string
	KindCode    string
	Size        string
	Expires     string
	Files       int
	HasDoc      bool
	DocURL      string
	DownloadURL string
}

type entryPage struct {
	Nav         Nav
	Entry       Entry
	Kind        string
	Size        string
	Expires     string
	Files       []fileRow
	AppURL      string
	RawURL      string
	DocURL      string
	DownloadURL string
	HasApp      bool
	IsImage     bool
	IsPDF       bool
	IsHTML      bool
	IsText      bool
	Error       string
}

type readerPage struct {
	Nav         Nav
	Entry       Entry
	Current     string
	Kind        string
	Size        string
	Expires     string
	Files       []fileRow
	DocHTML     template.HTML
	PreviewURL  string
	RawURL      string
	DownloadURL string
	PreviewKind string
	Error       string
}

type fileRow struct {
	Path      string
	ReaderURL string
	RawURL    string
	Size      string
	Active    bool
	Doc       bool
}

func (h *Handler) redirectIndex(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, strings.TrimSuffix(r.URL.Path, "/")+"/", http.StatusTemporaryRedirect)
}

func (h *Handler) redirectEntry(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, r.URL.Path+"/", http.StatusTemporaryRedirect)
}

func (h *Handler) redirectFiles(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "../e/"+r.PathValue("id")+"/", http.StatusTemporaryRedirect)
}

func (h *Handler) index(w http.ResponseWriter, r *http.Request) {
	entries, err := h.store.List()
	if err != nil {
		h.log.Error("drop list failed", "error", err)
		h.renderError(w, http.StatusInternalServerError, "Не удалось прочитать буфер.")
		return
	}
	cards := make([]entryCard, 0, len(entries))
	for _, entry := range entries {
		cards = append(cards, h.card(entry))
	}
	h.render(w, http.StatusOK, "index.html", indexPage{
		Nav:      h.links,
		Entries:  cards,
		Max:      humanSize(h.maxUpload),
		NowLabel: "7 дней по умолчанию",
	})
}

func (h *Handler) card(entry Entry) entryCard {
	card := entryCard{
		Entry:   entry,
		URL:      "e/" + entry.ID + "/",
		Kind:     kindLabel(entry.Kind),
		KindCode: entry.Kind,
		Size:     humanSize(entry.Size),
		Expires: expiresLabel(entry, h.now()),
		Files:   len(entry.Files),
	}
	if doc := entry.Doc(); doc != "" {
		card.HasDoc = true
		card.DocURL = "e/" + entry.ID + "/?file=" + url.QueryEscape(doc)
	}
	if len(entry.Files) == 1 {
		card.DownloadURL = "download/" + entry.ID + "/" + escapePath(entry.Files[0].Path)
	}
	return card
}

func (h *Handler) entry(w http.ResponseWriter, r *http.Request) {
	entry, err := h.store.Get(r.PathValue("id"))
	if err != nil {
		h.renderError(w, http.StatusNotFound, "Публикация не найдена или уже истекла.")
		return
	}
	file := r.URL.Query().Get("file")
	if file != "" {
		h.reader(w, r, entry, file)
		return
	}
	if entry.Kind == "docs" {
		if doc := entry.Doc(); doc != "" {
			http.Redirect(w, r, "?file="+url.QueryEscape(doc), http.StatusSeeOther)
			return
		}
	}
	data := entryPage{
		Nav:     h.links,
		Entry:   entry,
		Kind:    kindLabel(entry.Kind),
		Size:    humanSize(entry.Size),
		Expires: expiresLabel(entry, h.now()),
		Files:   h.rows(entry, ""),
	}
	if app := entry.App(); app != "" {
		data.HasApp = true
		data.AppURL = "../../files/" + entry.ID + "/"
		if app != "index.html" && app != "index.htm" {
			data.AppURL += escapePath(app)
		}
	}
	if len(entry.Files) == 1 {
		name := entry.Files[0].Path
		data.RawURL = "../../files/" + entry.ID + "/" + escapePath(name)
		data.DownloadURL = "../../download/" + entry.ID + "/" + escapePath(name)
		data.IsImage = isImagePath(name)
		data.IsPDF = strings.EqualFold(path.Ext(name), ".pdf")
		data.IsHTML = isHTMLPath(name)
		data.IsText = isReadableText(name)
		if data.IsText && !data.HasApp {
			data.DocURL = "?file=" + url.QueryEscape(name)
		}
	}
	h.render(w, http.StatusOK, "entry.html", data)
}

func (h *Handler) reader(w http.ResponseWriter, r *http.Request, entry Entry, file string) {
	rel, err := safeRel(file)
	if err != nil {
		h.renderError(w, http.StatusBadRequest, "Некорректный путь.")
		return
	}
	full, err := h.store.FilePath(entry.ID, rel)
	if err != nil {
		h.renderError(w, http.StatusBadRequest, "Некорректный путь.")
		return
	}
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		if doc := entry.docInDir(rel); doc != "" {
			http.Redirect(w, r, "?file="+url.QueryEscape(doc), http.StatusSeeOther)
			return
		}
		h.renderError(w, http.StatusNotFound, "Файл не найден.")
		return
	}
	data := readerPage{
		Nav:         h.links,
		Entry:       entry,
		Current:     rel,
		Kind:        "text",
		Size:        humanSize(info.Size()),
		Expires:     expiresLabel(entry, h.now()),
		Files:       h.rows(entry, rel),
		RawURL:      "../../files/" + entry.ID + "/" + escapePath(rel),
		DownloadURL: "../../download/" + entry.ID + "/" + escapePath(rel),
	}
	switch {
	case isImagePath(rel):
		data.Kind = "image"
		data.PreviewKind = "image"
		data.PreviewURL = data.RawURL
	case strings.EqualFold(path.Ext(rel), ".pdf"):
		data.Kind = "pdf"
		data.PreviewKind = "pdf"
		data.PreviewURL = data.RawURL
	case isHTMLPath(rel):
		data.Kind = "html"
		data.PreviewKind = "html"
		data.PreviewURL = data.RawURL
	case isDocPath(rel):
		data.Kind = "markdown"
		source, err := readLimited(full, 4<<20)
		if err != nil {
			h.renderError(w, http.StatusInternalServerError, "Не удалось прочитать документ.")
			return
		}
		rendered, err := renderMarkdown(entry, rel, source, "../../files/"+entry.ID)
		if err != nil {
			h.renderError(w, http.StatusInternalServerError, "Не удалось отобразить документ.")
			return
		}
		data.DocHTML = template.HTML(rendered)
	case isReadableText(rel):
		data.Kind = "text"
		source, err := readLimited(full, 4<<20)
		if err != nil {
			h.renderError(w, http.StatusInternalServerError, "Не удалось прочитать файл.")
			return
		}
		data.DocHTML = template.HTML("<pre>" + html.EscapeString(string(source)) + "</pre>")
	default:
		data.Kind = "binary"
	}
	h.render(w, http.StatusOK, "reader.html", data)
}

func (h *Handler) rows(entry Entry, current string) []fileRow {
	rows := make([]fileRow, 0, len(entry.Files))
	for _, file := range entry.Files {
		if strings.HasPrefix(file.Path, ".") {
			continue
		}
		rows = append(rows, fileRow{
			Path:      file.Path,
			ReaderURL: "?file=" + url.QueryEscape(file.Path),
			RawURL:    "../../files/" + entry.ID + "/" + escapePath(file.Path),
			Size:      humanSize(file.Size),
			Active:    file.Path == current,
			Doc:       isReadableText(file.Path),
		})
	}
	return rows
}

func (h *Handler) file(w http.ResponseWriter, r *http.Request) {
	h.serve(w, r, false)
}

func (h *Handler) download(w http.ResponseWriter, r *http.Request) {
	h.serve(w, r, true)
}

func (h *Handler) serve(w http.ResponseWriter, r *http.Request, attachment bool) {
	entry, err := h.store.Get(r.PathValue("id"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	rel := strings.TrimPrefix(r.PathValue("path"), "/")
	if rel == "" {
		rel = entry.App()
	}
	if rel == "" {
		http.Redirect(w, r, "../../e/"+entry.ID+"/", http.StatusTemporaryRedirect)
		return
	}
	rel, err = safeRel(rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	full, err := h.store.FilePath(entry.ID, rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		if entry.Kind == "site" && path.Ext(rel) == "" {
			rel = entry.App()
			if rel == "" {
				http.NotFound(w, r)
				return
			}
			full, err = h.store.FilePath(entry.ID, rel)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			info, err = os.Stat(full)
		}
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
	}
	file, err := os.Open(full)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	name := path.Base(rel)
	ext := strings.ToLower(path.Ext(rel))
	contentType := mime.TypeByExtension(ext)
	if contentType == "" {
		switch ext {
		case ".md", ".markdown":
			contentType = "text/markdown; charset=utf-8"
		case ".txt", ".log":
			contentType = "text/plain; charset=utf-8"
		default:
			contentType = "application/octet-stream"
		}
	}
	if isHTMLPath(rel) {
		contentType = "text/html; charset=utf-8"
		w.Header().Set("Content-Security-Policy", appCSP)
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	}
	if ext == ".svg" {
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	}
	if attachment {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=60")
	http.ServeContent(w, r, name, info.ModTime(), file)
}

func (h *Handler) static(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !fs.ValidPath(name) || strings.Contains(name, "/") {
		http.NotFound(w, r)
		return
	}
	data, err := fs.ReadFile(assets, "static/"+name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", mime.TypeByExtension(path.Ext(name)))
	w.Header().Set("Cache-Control", "private, max-age=3600")
	_, _ = w.Write(data)
}

func (h *Handler) upload(w http.ResponseWriter, r *http.Request) {
	if h.guard != nil && !h.guard(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, h.maxUpload)
	reader, err := r.MultipartReader()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "expected multipart form"})
		return
	}
	var builder *Builder
	var name string
	ttl := DefaultTTL
	files := 0
	fail := func(status int, message string) {
		if builder != nil {
			builder.Abort()
		}
		writeJSON(w, status, map[string]string{"error": message})
	}
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				fail(http.StatusRequestEntityTooLarge, "upload is too large")
				return
			}
			fail(http.StatusBadRequest, "could not read upload")
			return
		}
		switch {
		case part.FormName() == "ttl":
			value, _ := io.ReadAll(io.LimitReader(part, 64))
			ttl, err = parseTTL(string(value))
			if err != nil {
				part.Close()
				fail(http.StatusBadRequest, err.Error())
				return
			}
		case part.FormName() == "name":
			value, _ := io.ReadAll(io.LimitReader(part, 256))
			name = string(value)
		case part.FileName() != "":
			if builder == nil {
				builder, err = h.store.NewEntry(nameOr(name, part.FileName()))
				if err != nil {
					part.Close()
					fail(http.StatusInternalServerError, "could not create upload")
					return
				}
			}
			if err := builder.AddFile(part.FileName(), part); err != nil {
				part.Close()
				var tooLarge *http.MaxBytesError
				if errors.As(err, &tooLarge) {
					fail(http.StatusRequestEntityTooLarge, "upload is too large")
					return
				}
				fail(http.StatusBadRequest, err.Error())
				return
			}
			files++
		}
		part.Close()
	}
	if builder == nil || files == 0 {
		fail(http.StatusBadRequest, "no files")
		return
	}
	builder.SetTTL(ttl)
	if strings.TrimSpace(name) != "" {
		builder.SetName(name)
	}
	entry, err := builder.Commit()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not save upload"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"id":   entry.ID,
		"url":  "e/" + entry.ID + "/",
		"kind": entry.Kind,
	})
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	if h.guard != nil && !h.guard(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	if err := h.store.Delete(body.ID); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) render(w http.ResponseWriter, status int, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", pageCSP)
	w.Header().Set("X-Frame-Options", "DENY")
	w.WriteHeader(status)
	if err := pages.ExecuteTemplate(w, name, data); err != nil {
		h.log.Error("drop template failed", "template", name, "error", err)
	}
}

func (h *Handler) renderError(w http.ResponseWriter, status int, message string) {
	h.render(w, status, "error.html", struct {
		Nav     Nav
		Message string
	}{h.links, message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func maxUploadBytes() int64 {
	raw := strings.TrimSpace(os.Getenv("NIT_DROP_MAX_UPLOAD"))
	if raw == "" {
		return 128 << 20
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return 128 << 20
	}
	return value
}

func parseTTL(raw string) (time.Duration, error) {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		return DefaultTTL, nil
	}
	if raw == "0" || raw == "never" || raw == "forever" {
		return 0, nil
	}
	if strings.HasSuffix(raw, "d") {
		days, err := strconv.Atoi(strings.TrimSuffix(raw, "d"))
		if err != nil || days < 0 {
			return 0, fmt.Errorf("invalid ttl")
		}
		return time.Duration(days) * 24 * time.Hour, nil
	}
	if strings.HasSuffix(raw, "w") {
		weeks, err := strconv.Atoi(strings.TrimSuffix(raw, "w"))
		if err != nil || weeks < 0 {
			return 0, fmt.Errorf("invalid ttl")
		}
		return time.Duration(weeks) * 7 * 24 * time.Hour, nil
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value < 0 {
		return 0, fmt.Errorf("invalid ttl")
	}
	return value, nil
}

func readLimited(name string, limit int64) ([]byte, error) {
	file, err := os.Open(name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(io.LimitReader(file, limit))
}

func nameOr(name, fallback string) string {
	if strings.TrimSpace(name) != "" {
		return name
	}
	return filepath.Base(fallback)
}

func isImagePath(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico":
		return true
	}
	return false
}

func kindLabel(kind string) string {
	switch kind {
	case "site":
		return "app"
	case "docs":
		return "docs"
	case "file":
		return "файл"
	default:
		return "папка"
	}
}

func humanSize(size int64) string {
	switch {
	case size >= 1<<30:
		return fmt.Sprintf("%.1f GB", float64(size)/(1<<30))
	case size >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(size)/(1<<20))
	case size >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(size)/(1<<10))
	default:
		return fmt.Sprintf("%d B", size)
	}
}

func expiresLabel(entry Entry, now time.Time) string {
	if entry.Expires.IsZero() {
		return "не истекает"
	}
	left := entry.Expires.Sub(now)
	if left <= 0 {
		return "истёк"
	}
	if left >= 48*time.Hour {
		return fmt.Sprintf("%d дн.", int(left/(24*time.Hour)))
	}
	if left >= time.Hour {
		return fmt.Sprintf("%d ч.", int(left/time.Hour))
	}
	return fmt.Sprintf("%d мин.", int(left/time.Minute))
}
