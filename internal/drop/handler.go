package drop

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	managerCSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"
	appCSP     = "sandbox allow-scripts allow-popups allow-downloads allow-top-navigation-by-user-activation; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"
	svgCSP     = "sandbox; default-src 'none'; style-src 'unsafe-inline'"
)

//go:embed templates/*.html static/*
var assets embed.FS

var pages = template.Must(template.ParseFS(assets, "templates/*.html"))

type Manager struct {
	store      *Store
	services   *Services
	guard      func(*http.Request) bool
	log        *slog.Logger
	maxUpload  int64
	peroURL    string
	publicBase string
	now        func() time.Time
}

func NewManager(store *Store, services *Services, guard func(*http.Request) bool, log *slog.Logger, peroURL, basePath string) http.Handler {
	if log == nil {
		log = slog.Default()
	}
	h := &Manager{
		store:      store,
		services:   services,
		guard:      guard,
		log:        log,
		maxUpload:  maxUploadBytes(),
		peroURL:    peroURL,
		publicBase: strings.TrimRight(basePath, "/") + "/",
		now:        time.Now,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", h.index)
	mux.HandleFunc("POST /api/upload", h.upload)
	mux.HandleFunc("PATCH /api/entries/{id}", h.update)
	mux.HandleFunc("DELETE /api/entries/{id}", h.delete)
	mux.HandleFunc("GET /e/{id}", h.redirectEntry)
	mux.HandleFunc("GET /e/{id}/{$}", h.redirectEntry)
	mux.HandleFunc("GET /files/{id}", h.redirectFiles)
	mux.HandleFunc("GET /files/{id}/{path...}", h.redirectFiles)
	mux.HandleFunc("GET /download/{id}", h.redirectFiles)
	mux.HandleFunc("GET /download/{id}/{path...}", h.redirectFiles)
	mux.HandleFunc("GET /static/{name}", h.static)
	return h.headers(mux)
}

func (h *Manager) headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

type indexPage struct {
	Entries []entryRow
}

type entryRow struct {
	Entry       Entry
	URL         string
	SlugPath    string
	Size        string
	Files       int
	Expires     string
	Forever     bool
	Public      bool
	Status      string
	DocURL      string
	RawDocURL   string
	Ext         string
	PreviewKind string
	PreviewURL  string
	PreviewText string
}

func (h *Manager) index(w http.ResponseWriter, r *http.Request) {
	entries, err := h.store.List()
	if err != nil {
		h.log.Error("drop list failed", "error", err)
		http.Error(w, "could not read drop", http.StatusInternalServerError)
		return
	}
	rows := make([]entryRow, 0, len(entries))
	for _, entry := range entries {
		rows = append(rows, h.row(r.Context(), entry))
	}
	h.render(w, http.StatusOK, "index.html", indexPage{Entries: rows})
}

func (h *Manager) row(ctx context.Context, entry Entry) entryRow {
	row := entryRow{
		Entry:    entry,
		URL:      h.publicBase + url.PathEscape(entry.Slug) + "/",
		SlugPath: h.publicBase + url.PathEscape(entry.Slug) + "/",
		Size:     humanSize(entry.Size),
		Files:    len(entry.Files),
		Expires:  expiresLabel(entry, h.now()),
		Forever:  entry.Forever(),
		Public:   entry.Public,
	}
	if entry.Kind == "service" && entry.Service != nil {
		row.Status = entry.Service.Status
		if h.services != nil {
			timeout, cancel := context.WithTimeout(ctx, 2*time.Second)
			row.Status = h.services.Status(timeout, entry)
			cancel()
		}
		if row.Status == "" {
			row.Status = "unknown"
		}
	}
	if doc := entry.Text(); doc != "" {
		row.RawDocURL = h.publicBase + url.PathEscape(entry.Slug) + "/" + escapePath(doc)
		if path, err := h.store.FilePath(entry.ID, doc); err == nil {
			row.DocURL = peroLink(h.peroURL, path)
		}
	}
	row.PreviewKind, row.PreviewURL, row.PreviewText = h.preview(entry)
	row.Ext = entryExt(entry)
	return row
}

func entryExt(entry Entry) string {
	if entry.Kind == "service" {
		return "APP"
	}
	name := entry.Name
	for _, file := range entry.Files {
		if path.Ext(file.Path) != "" {
			name = file.Path
			break
		}
	}
	ext := strings.ToUpper(strings.TrimPrefix(path.Ext(name), "."))
	if len(ext) > 4 {
		ext = ext[:4]
	}
	if ext == "" {
		ext = "FILE"
	}
	return ext
}

func (h *Manager) preview(entry Entry) (string, string, string) {
	if entry.Kind == "service" {
		return "", "", ""
	}
	if entry.App() != "" {
		return "page", h.publicBase + url.PathEscape(entry.Slug) + "/", ""
	}
	if doc := entry.Text(); doc != "" {
		return "text", "", h.previewText(entry, doc)
	}
	for _, file := range entry.Files {
		if isImagePath(file.Path) {
			return "image", h.publicBase + url.PathEscape(entry.Slug) + "/" + escapePath(file.Path), ""
		}
	}
	return "", "", ""
}

func (h *Manager) previewText(entry Entry, rel string) string {
	full, err := h.store.FilePath(entry.ID, rel)
	if err != nil {
		return ""
	}
	file, err := os.Open(full)
	if err != nil {
		return ""
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 1200))
	if err != nil {
		return ""
	}
	return strings.ToValidUTF8(string(data), " ")
}

func peroLink(base, file string) string {
	if strings.TrimSpace(base) == "" {
		return ""
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return ""
	}
	query := parsed.Query()
	query.Set("open", file)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func (h *Manager) redirectEntry(w http.ResponseWriter, r *http.Request) {
	h.redirectOld(w, r, r.URL.Query().Get("file"))
}

func (h *Manager) redirectFiles(w http.ResponseWriter, r *http.Request) {
	h.redirectOld(w, r, strings.TrimPrefix(r.PathValue("path"), "/"))
}

func (h *Manager) redirectOld(w http.ResponseWriter, r *http.Request, file string) {
	entry, err := h.store.Get(r.PathValue("id"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	target := h.publicBase + url.PathEscape(entry.Slug) + "/"
	if file != "" {
		rel, err := safeRel(file)
		if err != nil {
			http.Error(w, "invalid path", http.StatusBadRequest)
			return
		}
		target += escapePath(rel)
	}
	http.Redirect(w, r, target, http.StatusMovedPermanently)
}

func (h *Manager) upload(w http.ResponseWriter, r *http.Request) {
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
	var name, slug string
	public := false
	forever := true
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
		case part.FormName() == "public":
			value, _ := io.ReadAll(io.LimitReader(part, 16))
			public = string(value) == "1" || strings.EqualFold(string(value), "true")
		case part.FormName() == "forever":
			value, _ := io.ReadAll(io.LimitReader(part, 16))
			forever = !(string(value) == "0" || strings.EqualFold(string(value), "false"))
		case part.FormName() == "slug":
			value, _ := io.ReadAll(io.LimitReader(part, 64))
			slug = string(value)
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
				builder.SetSlug(slug)
				builder.SetPublic(public)
				if !forever {
					builder.SetTTL(ShortExpiry)
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
	if strings.TrimSpace(slug) != "" {
		builder.SetSlug(slug)
	}
	builder.SetPublic(public)
	if forever {
		builder.SetTTL(0)
	} else {
		builder.SetTTL(ShortExpiry)
	}
	if strings.TrimSpace(name) != "" {
		builder.SetName(name)
	}
	entry, err := builder.Commit()
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrSlugTaken) {
			status = http.StatusConflict
		} else if errors.Is(err, ErrInvalidSlug) {
			status = http.StatusBadRequest
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, h.entryJSON(entry))
}

func (h *Manager) update(w http.ResponseWriter, r *http.Request) {
	if h.guard != nil && !h.guard(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var body struct {
		Slug    *string `json:"slug"`
		Public  *bool   `json:"public"`
		Forever *bool   `json:"forever"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	entry, err := h.store.Get(r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	if body.Slug != nil {
		entry, err = h.store.SetSlug(entry.ID, *body.Slug)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, ErrSlugTaken) {
				status = http.StatusConflict
			} else if errors.Is(err, ErrInvalidSlug) {
				status = http.StatusBadRequest
			}
			writeJSON(w, status, map[string]string{"error": err.Error()})
			return
		}
	}
	if body.Public != nil {
		entry, err = h.store.SetPublic(entry.ID, *body.Public)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
	}
	if body.Forever != nil {
		entry, err = h.store.SetForever(entry.ID, *body.Forever)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
	}
	writeJSON(w, http.StatusOK, h.entryJSON(entry))
}

func (h *Manager) delete(w http.ResponseWriter, r *http.Request) {
	if h.guard != nil && !h.guard(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}
	if err := h.store.Delete(r.PathValue("id")); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Manager) entryJSON(entry Entry) map[string]any {
	out := map[string]any{
		"id":      entry.ID,
		"slug":    entry.Slug,
		"aliases": entry.Aliases,
		"name":    entry.Name,
		"public":  entry.Public,
		"forever": entry.Forever(),
		"url":     h.publicBase + url.PathEscape(entry.Slug) + "/",
	}
	if entry.Expires != nil {
		out["expires"] = entry.Expires
	}
	return out
}

func (h *Manager) static(w http.ResponseWriter, r *http.Request) {
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
	contentType := mime.TypeByExtension(path.Ext(name))
	if strings.Contains(contentType, "html") {
		contentType = "text/html; charset=utf-8"
		w.Header().Set("Content-Security-Policy", appCSP)
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}

func (h *Manager) render(w http.ResponseWriter, status int, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", managerCSP)
	w.Header().Set("X-Frame-Options", "DENY")
	w.WriteHeader(status)
	if err := pages.ExecuteTemplate(w, name, data); err != nil {
		h.log.Error("drop template failed", "template", name, "error", err)
	}
}

type Public struct {
	store         *Store
	services      *Services
	authenticated func(*http.Request) bool
	log           *slog.Logger
	publicBase    string
}

func NewPublic(store *Store, authenticated func(*http.Request) bool, log *slog.Logger, basePath string, services *Services) http.Handler {
	if log == nil {
		log = slog.Default()
	}
	h := &Public{
		store:         store,
		services:      services,
		authenticated: authenticated,
		log:           log,
		publicBase:    strings.TrimRight(basePath, "/") + "/",
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/{slug}", h.redirectSlash)
	mux.HandleFunc("/{slug}/{$}", h.serve)
	mux.HandleFunc("/{slug}/{path...}", h.serve)
	return h.headers(mux)
}

func (h *Public) headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
		next.ServeHTTP(w, r)
	})
}

func (h *Public) redirectSlash(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	target := h.publicBase + url.PathEscape(slug) + "/"
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}
	status := http.StatusMovedPermanently
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		status = http.StatusPermanentRedirect
	}
	http.Redirect(w, r, target, status)
}

func (h *Public) serve(w http.ResponseWriter, r *http.Request) {
	entry, err := h.store.GetBySlug(r.PathValue("slug"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if !entry.Public && (h.authenticated == nil || !h.authenticated(r)) {
		http.NotFound(w, r)
		return
	}
	if entry.Kind == "service" {
		h.service(w, r, entry)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rel := strings.TrimPrefix(r.PathValue("path"), "/")
	if rel == "" {
		if index := dirIndex(entry, ""); index != "" {
			h.file(w, r, entry, index)
			return
		}
		if len(entry.Files) == 1 {
			h.file(w, r, entry, entry.Files[0].Path)
			return
		}
		h.autoindex(w, r, entry, "")
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
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if info.IsDir() {
		if !strings.HasSuffix(r.URL.Path, "/") {
			target := h.publicBase + url.PathEscape(r.PathValue("slug")) + "/" + escapePath(rel) + "/"
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, target, http.StatusMovedPermanently)
			return
		}
		if index := dirIndex(entry, rel); index != "" {
			h.file(w, r, entry, index)
			return
		}
		h.autoindex(w, r, entry, rel)
		return
	}
	h.file(w, r, entry, rel)
}

func (h *Public) service(w http.ResponseWriter, r *http.Request, entry Entry) {
	if h.services == nil {
		http.Error(w, "services are unavailable", http.StatusServiceUnavailable)
		return
	}
	port, err := h.services.Port(entry)
	if err != nil {
		h.services.Forget(entry.ID)
		h.log.Warn("drop service is not reachable", "slug", entry.Slug, "error", err)
		http.Error(w, "service is not running", http.StatusBadGateway)
		return
	}
	slug := r.PathValue("slug")
	prefix := strings.TrimSuffix(h.publicBase, "/") + "/" + url.PathEscape(slug)
	rest := strings.TrimPrefix(r.URL.Path, "/"+slug)
	if rest == "" {
		rest = "/"
	}
	host := fmt.Sprintf("127.0.0.1:%d", port)
	originalHost := r.Host
	originalProto := r.Header.Get("X-Forwarded-Proto")
	proxy := httputil.NewSingleHostReverseProxy(&url.URL{Scheme: "http", Host: host})
	proxy.FlushInterval = -1
	proxy.Director = func(req *http.Request) {
		req.URL.Scheme = "http"
		req.URL.Host = host
		req.URL.Path = rest
		req.URL.RawPath = ""
		req.Host = host
		stripServiceHeaders(req.Header)
		req.Header.Set("X-Forwarded-Prefix", prefix)
		req.Header.Set("X-Forwarded-Host", originalHost)
		if req.Header.Get("X-Forwarded-Proto") == "" {
			proto := originalProto
			if proto == "" {
				proto = "http"
				if r.TLS != nil {
					proto = "https"
				}
			}
			req.Header.Set("X-Forwarded-Proto", proto)
		}
	}
	cookiePath := prefix + "/"
	proxy.ModifyResponse = func(resp *http.Response) error {
		rewriteServiceCookies(resp.Header, cookiePath)
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		h.services.Forget(entry.ID)
		h.log.Warn("drop service proxy failed", "slug", entry.Slug, "error", err)
		http.Error(w, "service is not reachable", http.StatusBadGateway)
	}
	proxy.ServeHTTP(w, r)
}

func stripServiceHeaders(header http.Header) {
	header.Del("Authorization")
	for name := range header {
		if strings.HasPrefix(strings.ToLower(name), "x-nit-") {
			delete(header, name)
		}
	}
	values := header.Values("Cookie")
	if len(values) == 0 {
		return
	}
	kept := make([]string, 0, len(values))
	for _, value := range values {
		for _, part := range strings.Split(value, ";") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			name, _, _ := strings.Cut(part, "=")
			if strings.EqualFold(strings.TrimSpace(name), "nit_gate") {
				continue
			}
			kept = append(kept, part)
		}
	}
	if len(kept) == 0 {
		header.Del("Cookie")
		return
	}
	header.Set("Cookie", strings.Join(kept, "; "))
}

func rewriteServiceCookies(header http.Header, path string) {
	values := header.Values("Set-Cookie")
	if len(values) == 0 {
		return
	}
	rewritten := make([]string, 0, len(values))
	for _, value := range values {
		cookie, err := http.ParseSetCookie(value)
		if err != nil {
			rewritten = append(rewritten, value)
			continue
		}
		if strings.EqualFold(cookie.Name, "nit_gate") {
			continue
		}
		cookie.Domain = ""
		cookie.Path = path
		rewritten = append(rewritten, cookie.String())
	}
	if len(rewritten) == 0 {
		header.Del("Set-Cookie")
		return
	}
	header["Set-Cookie"] = rewritten
}

func dirIndex(entry Entry, dir string) string {
	prefix := ""
	if dir != "" && dir != "." {
		prefix = strings.TrimSuffix(dir, "/") + "/"
	}
	for _, name := range []string{"index.html", "index.htm"} {
		if entry.Has(prefix + name) {
			return prefix + name
		}
	}
	return ""
}

func (h *Public) file(w http.ResponseWriter, r *http.Request, entry Entry, rel string) {
	if hiddenPath(rel) && !(len(entry.Files) == 1 && entry.Files[0].Path == rel) {
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
		http.NotFound(w, r)
		return
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
		case ".md", ".markdown", ".mdown":
			contentType = "text/markdown; charset=utf-8"
		case ".txt", ".log":
			contentType = "text/plain; charset=utf-8"
		default:
			if isReadableText(rel) {
				contentType = "text/plain; charset=utf-8"
			} else {
				contentType = "application/octet-stream"
			}
		}
	}
	html := strings.Contains(contentType, "html") || isHTMLPath(rel)
	if html {
		contentType = "text/html; charset=utf-8"
		w.Header().Set("Content-Security-Policy", appCSP)
	}
	if ext == ".svg" {
		w.Header().Set("Content-Security-Policy", svgCSP)
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cross-Origin-Resource-Policy", "cross-origin")
	if html || ext == ".md" || ext == ".markdown" || ext == ".txt" {
		w.Header().Set("Cache-Control", "no-store")
	} else {
		w.Header().Set("Cache-Control", "private, max-age=60")
	}
	http.ServeContent(w, r, name, info.ModTime(), file)
}

type autoFile struct {
	Path string
	URL  string
	Size string
}

type autoPage struct {
	Title     string
	Parent    string
	HasParent bool
	Files     []autoFile
}

func (h *Public) autoindex(w http.ResponseWriter, r *http.Request, entry Entry, dir string) {
	prefix := ""
	if dir != "" && dir != "." {
		prefix = strings.TrimSuffix(dir, "/") + "/"
	}
	files := make([]autoFile, 0, len(entry.Files))
	for _, file := range entry.Files {
		if !strings.HasPrefix(file.Path, prefix) {
			continue
		}
		if hiddenPath(file.Path) {
			continue
		}
		base := r.PathValue("slug")
		files = append(files, autoFile{
			Path: file.Path,
			URL:  h.publicBase + url.PathEscape(base) + "/" + escapePath(file.Path),
			Size: humanSize(file.Size),
		})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	page := autoPage{
		Title: entry.Name,
		Files: files,
	}
	if dir != "" && dir != "." {
		page.HasParent = true
		parent := path.Dir(dir)
		if parent == "." {
			parent = ""
		}
		page.Parent = h.publicBase + url.PathEscape(r.PathValue("slug")) + "/"
		if parent != "" {
			page.Parent += escapePath(parent) + "/"
		}
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", managerCSP)
	w.Header().Set("X-Frame-Options", "DENY")
	w.WriteHeader(http.StatusOK)
	if err := pages.ExecuteTemplate(w, "autoindex.html", page); err != nil {
		h.log.Error("drop autoindex failed", "error", err)
	}
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

func ParseTTL(raw string) (time.Duration, error) {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		return 0, nil
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

func hiddenPath(name string) bool {
	for _, part := range strings.Split(name, "/") {
		if strings.HasPrefix(part, ".") {
			return true
		}
	}
	return false
}

func nameOr(name, fallback string) string {
	if strings.TrimSpace(name) != "" {
		return name
	}
	return filepath.Base(fallback)
}

func escapePath(name string) string {
	parts := strings.Split(name, "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
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
	if entry.Expires == nil {
		return ""
	}
	left := entry.Expires.Sub(now)
	if left <= 0 {
		return "expired"
	}
	return entry.Expires.Format("2 Jan 2006")
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
