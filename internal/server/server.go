package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"nitgui/internal/opencode"
)

const maxJSONBody = 1 << 20

type ClientProvider interface {
	Client(context.Context) (*opencode.Client, error)
	Drop()
}

type Server struct {
	provider     ClientProvider
	static       fs.FS
	log          *slog.Logger
	mux          *http.ServeMux
	fast         *fastSTT
	grammar      *grammarChecker
	allowedHosts map[string]struct{}
}

func New(provider ClientProvider, static fs.FS, log *slog.Logger) http.Handler {
	if log == nil {
		log = slog.Default()
	}
	s := &Server{
		provider:     provider,
		static:       static,
		log:          log,
		mux:          http.NewServeMux(),
		fast:         newFastSTT(log),
		grammar:      newGrammarChecker(log),
		allowedHosts: map[string]struct{}{},
	}
	for _, host := range strings.Split(os.Getenv("NIT_GUI_ALLOWED_HOSTS"), ",") {
		if host = strings.ToLower(strings.TrimSpace(host)); host != "" {
			s.allowedHosts[host] = struct{}{}
		}
	}
	s.routes()
	go s.warm()
	return s.middleware(s.mux)
}

func (s *Server) warm() {
	if os.Getenv("NIT_GUI_WARM") == "0" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		if err := s.grammar.ensure(ctx); err != nil {
			s.log.Debug("grammar warmup skipped", "error", err)
			return
		}
		s.log.Info("grammar ready", "url", s.grammar.url)
	}()
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		if err := s.fast.ensure(ctx); err != nil {
			s.log.Debug("fast stt warmup skipped", "error", err)
			return
		}
		s.log.Info("fast stt ready")
	}()
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.health)
	s.mux.HandleFunc("GET /api/config", s.config)
	s.mux.HandleFunc("GET /api/projects", s.projects)
	s.mux.HandleFunc("GET /api/sessions", s.sessions)
	s.mux.HandleFunc("POST /api/sessions", s.createSession)
	s.mux.HandleFunc("DELETE /api/sessions/{id}", s.deleteSession)
	s.mux.HandleFunc("GET /api/sessions/{id}/messages", s.messages)
	s.mux.HandleFunc("GET /api/sessions/{id}/children", s.children)
	s.mux.HandleFunc("POST /api/sessions/{id}/prompt", s.prompt)
	s.mux.HandleFunc("POST /api/sessions/{id}/interrupt", s.interrupt)
	s.mux.HandleFunc("POST /api/sessions/{id}/revert", s.revert)
	s.mux.HandleFunc("POST /api/sessions/{id}/fork", s.fork)
	s.mux.HandleFunc("POST /api/sessions/{id}/compact", s.compact)
	s.mux.HandleFunc("POST /api/stt", s.stt)
	s.mux.HandleFunc("POST /api/grammar", s.grammarCheck)
	s.mux.HandleFunc("POST /api/upload", s.upload)
	s.mux.HandleFunc("GET /api/file", s.file)
	s.mux.HandleFunc("GET /api/sessions/{id}/form", s.forms)
	s.mux.HandleFunc("POST /api/sessions/{id}/form/{formID}/reply", s.replyForm)
	s.mux.HandleFunc("DELETE /api/sessions/{id}/form/{formID}", s.cancelForm)
	s.mux.HandleFunc("POST /api/sessions/{id}/model", s.switchModel)
	s.mux.HandleFunc("POST /api/sessions/{id}/agent", s.switchAgent)
	s.mux.HandleFunc("GET /api/models", s.models)
	s.mux.HandleFunc("GET /api/agents", s.agents)
	s.mux.HandleFunc("GET /api/events", s.events)
	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})
	s.mux.HandleFunc("/", s.staticFile)
}

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		if !s.allowedHost(r.Host) {
			writeError(w, http.StatusForbidden, "host not allowed")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && !allowedOrigin(r) {
			writeError(w, http.StatusForbidden, "origin not allowed")
			return
		}
		if r.URL.Path != "/api/events" {
			_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(30 * time.Second))
		}
		defer func() {
			if v := recover(); v != nil {
				s.log.Error("panic", "value", v)
				writeError(w, http.StatusInternalServerError, "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) allowedHost(hostport string) bool {
	if hostport == "" {
		return false
	}
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") || host == "127.0.0.1" || host == "::1" {
		return true
	}
	_, ok := s.allowedHosts[strings.ToLower(host)]
	return ok
}

func allowedOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	return strings.EqualFold(u.Host, r.Host)
}

func (s *Server) client(ctx context.Context) (*opencode.Client, bool) {
	c, err := s.provider.Client(ctx)
	if err != nil {
		return nil, false
	}
	return c, true
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	c, err := s.provider.Client(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	var info struct {
		Version string `json:"version"`
	}
	if err := c.Do(r.Context(), http.MethodGet, "/api/info", nil, &info); err != nil {
		s.provider.Drop()
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "server": c.BaseURL, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "server": c.BaseURL, "version": info.Version})
}

func (s *Server) sessions(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	q := url.Values{}
	q.Set("limit", "100")
	q.Set("order", "desc")
	q.Set("archived", "false")
	if r.URL.Query().Get("children") != "true" {
		q.Set("parentID", "null")
	}
	if dir := strings.TrimSpace(r.URL.Query().Get("dir")); dir != "" {
		if !filepath.IsAbs(dir) {
			writeError(w, http.StatusBadRequest, "dir must be absolute")
			return
		}
		q.Set("directory", dir)
	}
	if search := strings.TrimSpace(r.URL.Query().Get("search")); search != "" {
		q.Set("search", search)
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodGet, "/api/session?"+q.Encode(), nil, &raw); err != nil {
		s.upstreamError(w, err)
		return
	}
	writeRaw(w, raw, c.Redactor())
}

type createSessionInput struct {
	Directory string             `json:"directory"`
	Title     string             `json:"title"`
	Agent     string             `json:"agent"`
	Model     *opencode.ModelRef `json:"model"`
}

func (s *Server) createSession(w http.ResponseWriter, r *http.Request) {
	in, err := decodeJSON[createSessionInput](w, r)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	dir := strings.TrimSpace(in.Directory)
	if dir == "" {
		var loc struct {
			Directory string `json:"directory"`
		}
		if err := c.Do(r.Context(), http.MethodGet, "/api/location", nil, &loc); err != nil {
			s.upstreamError(w, err)
			return
		}
		dir = loc.Directory
	}
	if !filepath.IsAbs(dir) {
		writeError(w, http.StatusBadRequest, "directory must be absolute")
		return
	}
	body := map[string]any{"location": map[string]string{"directory": dir}}
	if strings.TrimSpace(in.Title) != "" {
		body["title"] = strings.TrimSpace(in.Title)
	}
	if strings.TrimSpace(in.Agent) != "" {
		body["agent"] = strings.TrimSpace(in.Agent)
	}
	if in.Model != nil && in.Model.ID != "" && in.Model.ProviderID != "" {
		body["model"] = in.Model
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodPost, "/api/session", body, &raw); err != nil {
		s.upstreamError(w, err)
		return
	}
	writeRaw(w, raw, c.Redactor())
}

func (s *Server) deleteSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	if err := c.Do(r.Context(), http.MethodDelete, "/api/session/"+url.PathEscape(id), nil, nil); err != nil {
		s.upstreamError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) messages(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	redactor := c.Redactor()
	data := []json.RawMessage{}
	cursor := ""
	for page := 0; page < 20; page++ {
		path := fmt.Sprintf("/api/session/%s/message?order=asc&limit=100", url.PathEscape(id))
		if cursor != "" {
			path = fmt.Sprintf("/api/session/%s/message?limit=100&cursor=%s", url.PathEscape(id), url.QueryEscape(cursor))
		}
		var env struct {
			Data   []json.RawMessage `json:"data"`
			Cursor struct {
				Next *string `json:"next"`
			} `json:"cursor"`
		}
		if err := c.Do(r.Context(), http.MethodGet, path, nil, &env); err != nil {
			s.upstreamError(w, err)
			return
		}
		for i, item := range env.Data {
			env.Data[i] = redactor.JSON(item)
		}
		data = append(data, env.Data...)
		if env.Cursor.Next == nil || *env.Cursor.Next == "" {
			break
		}
		cursor = *env.Cursor.Next
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": data})
}

func (s *Server) children(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	q := url.Values{}
	q.Set("limit", "100")
	q.Set("order", "desc")
	q.Set("archived", "false")
	q.Set("parentID", id)
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodGet, "/api/session?"+q.Encode(), nil, &raw); err != nil {
		s.upstreamError(w, err)
		return
	}
	writeRaw(w, raw, c.Redactor())
}

type promptFile struct {
	URI  string `json:"uri"`
	Name string `json:"name,omitempty"`
}

type promptInput struct {
	Text     string       `json:"text"`
	Files    []promptFile `json:"files,omitempty"`
	Delivery string       `json:"delivery,omitempty"`
}

func (s *Server) prompt(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	in, err := decodeJSON[promptInput](w, r)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	if strings.TrimSpace(in.Text) == "" && len(in.Files) == 0 {
		writeError(w, http.StatusBadRequest, "text or files are required")
		return
	}
	for _, file := range in.Files {
		if !strings.HasPrefix(file.URI, "file://") {
			writeError(w, http.StatusBadRequest, "only file:// attachments are supported")
			return
		}
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	body := map[string]any{"text": in.Text}
	if len(in.Files) > 0 {
		body["files"] = in.Files
	}
	if in.Delivery == "queue" || in.Delivery == "steer" {
		body["delivery"] = in.Delivery
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodPost, "/api/session/"+url.PathEscape(id)+"/prompt", body, &raw); err != nil {
		s.upstreamError(w, err)
		return
	}
	writeRaw(w, raw, c.Redactor())
}

func (s *Server) interrupt(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodPost, "/api/session/"+url.PathEscape(id)+"/interrupt", nil, &raw); err != nil {
		s.upstreamError(w, err)
		return
	}
	writeRaw(w, raw, c.Redactor())
}

func (s *Server) revert(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	in, err := decodeJSON[struct {
		MessageID string `json:"messageID"`
	}](w, r)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	if in.MessageID == "" {
		writeError(w, http.StatusBadRequest, "messageID is required")
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	path := "/api/session/" + url.PathEscape(id) + "/revert"
	if err := c.Do(r.Context(), http.MethodPost, path+"/stage", map[string]any{"messageID": in.MessageID, "files": false}, nil); err != nil {
		s.upstreamError(w, err)
		return
	}
	if err := c.Do(r.Context(), http.MethodPost, path+"/commit", map[string]any{}, nil); err != nil {
		s.upstreamError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) fork(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	in, err := decodeJSON[struct {
		Before string `json:"before"`
	}](w, r)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	body := map[string]any{}
	if in.Before != "" {
		body["before"] = in.Before
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodPost, "/api/session/"+url.PathEscape(id)+"/fork", body, &raw); err != nil {
		s.upstreamError(w, err)
		return
	}
	writeRaw(w, raw, c.Redactor())
}

func (s *Server) compact(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	if err := c.Do(r.Context(), http.MethodPost, "/api/session/"+url.PathEscape(id)+"/compact", map[string]any{}, nil); err != nil {
		s.upstreamError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) switchModel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	in, err := decodeJSON[struct {
		Model opencode.ModelRef `json:"model"`
	}](w, r)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	if in.Model.ID == "" || in.Model.ProviderID == "" {
		writeError(w, http.StatusBadRequest, "model is required")
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodPost, "/api/session/"+url.PathEscape(id)+"/model", map[string]any{"model": in.Model}, &raw); err != nil {
		s.upstreamError(w, err)
		return
	}
	writeRaw(w, raw, c.Redactor())
}

func (s *Server) switchAgent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	in, err := decodeJSON[struct {
		Agent string `json:"agent"`
	}](w, r)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	if strings.TrimSpace(in.Agent) == "" {
		writeError(w, http.StatusBadRequest, "agent is required")
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodPost, "/api/session/"+url.PathEscape(id)+"/agent", map[string]string{"agent": strings.TrimSpace(in.Agent)}, &raw); err != nil {
		s.upstreamError(w, err)
		return
	}
	writeRaw(w, raw, c.Redactor())
}

type modelOut struct {
	ID           string `json:"id"`
	ModelID      string `json:"modelID"`
	ProviderID   string `json:"providerID"`
	Name         string `json:"name"`
	Status       string `json:"status"`
	Enabled      bool   `json:"enabled"`
	Capabilities struct {
		Input []string `json:"input"`
	} `json:"capabilities"`
	Variants []struct {
		ID string `json:"id"`
	} `json:"variants"`
	Cost []struct {
		Input  float64 `json:"input"`
		Output float64 `json:"output"`
		Cache  struct {
			Read  float64 `json:"read"`
			Write float64 `json:"write"`
		} `json:"cache"`
	} `json:"cost"`
	Limit struct {
		Context int `json:"context"`
		Output  int `json:"output"`
	} `json:"limit"`
}

func (s *Server) models(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	var env struct {
		Location json.RawMessage `json:"location"`
		Data     []modelOut      `json:"data"`
	}
	path := "/api/model"
	if dir := strings.TrimSpace(r.URL.Query().Get("dir")); dir != "" {
		if !filepath.IsAbs(dir) {
			writeError(w, http.StatusBadRequest, "dir must be absolute")
			return
		}
		path += "?directory=" + url.QueryEscape(dir)
	}
	if err := c.Do(r.Context(), http.MethodGet, path, nil, &env); err != nil {
		s.upstreamError(w, err)
		return
	}
	if env.Data == nil {
		env.Data = []modelOut{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"location": env.Location, "data": env.Data})
}

type agentOut struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Mode        string             `json:"mode"`
	Hidden      bool               `json:"hidden"`
	Model       *opencode.ModelRef `json:"model,omitempty"`
}

func (s *Server) agents(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	var env struct {
		Data []agentOut `json:"data"`
	}
	if err := c.Do(r.Context(), http.MethodGet, "/api/agent", nil, &env); err != nil {
		s.upstreamError(w, err)
		return
	}
	if env.Data == nil {
		env.Data = []agentOut{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": env.Data})
}

const (
	maxUploadBody = 20 << 20
	maxSTTBody    = 30 << 20
)

func uploadPrefix() string {
	return filepath.Join(os.TempDir(), "nit-gui-")
}

func safeUploadName(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	if name == "" || name == "." || name == "/" {
		name = "file"
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	var clean strings.Builder
	for _, r := range stem {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == '_':
			clean.WriteRune(r)
		default:
			clean.WriteByte('_')
		}
	}
	stem = strings.Trim(clean.String(), "._-")
	if stem == "" {
		stem = "file"
	}
	if len(stem) > 80 {
		stem = stem[:80]
	}
	for _, r := range ext {
		if r != '.' && !(r >= 'a' && r <= 'z') && !(r >= 'A' && r <= 'Z') && !(r >= '0' && r <= '9') {
			ext = ""
			break
		}
	}
	return stem + ext
}

func uploadedPath(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	if strings.HasPrefix(raw, "file://") {
		parsed, err := url.Parse(raw)
		if err != nil || (parsed.Host != "" && parsed.Host != "localhost") {
			return "", false
		}
		raw = parsed.Path
	}
	path := filepath.Clean(raw)
	if !strings.HasPrefix(path, uploadPrefix()) {
		return "", false
	}
	return path, true
}

func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	dir := strings.TrimSpace(r.URL.Query().Get("dir"))
	if dir != "" && !filepath.IsAbs(dir) {
		writeError(w, http.StatusBadRequest, "dir must be absolute")
		return
	}
	name := filepath.Base(strings.TrimSpace(r.URL.Query().Get("name")))
	if name == "" || name == "." || name == "/" {
		name = "file"
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, maxUploadBody+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read upload")
		return
	}
	if len(data) == 0 {
		writeError(w, http.StatusBadRequest, "upload is empty")
		return
	}
	if len(data) > maxUploadBody {
		writeError(w, http.StatusRequestEntityTooLarge, "upload is too large")
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	path := filepath.Join(os.TempDir(), fmt.Sprintf("nit-gui-%d-%s", time.Now().UnixNano(), safeUploadName(name)))
	saved, err := c.WriteFile(r.Context(), dir, path, data)
	if err != nil {
		s.upstreamError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": saved, "name": name, "size": len(data)})
}

func (s *Server) file(w http.ResponseWriter, r *http.Request) {
	path, ok := uploadedPath(r.URL.Query().Get("path"))
	if !ok {
		writeError(w, http.StatusForbidden, "only uploaded files are served")
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	body, err := c.ReadFile(r.Context(), path)
	if err != nil {
		s.upstreamError(w, err)
		return
	}
	defer body.Body.Close()
	contentType := mime.TypeByExtension(filepath.Ext(path))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	if _, err := io.Copy(w, body.Body); err != nil {
		s.log.Warn("file stream failed", "path", path, "error", err)
	}
}

func (s *Server) forms(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodGet, "/api/session/"+url.PathEscape(id)+"/form", nil, &raw); err != nil {
		s.upstreamError(w, err)
		return
	}
	writeRaw(w, raw, c.Redactor())
}

func (s *Server) replyForm(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	formID := r.PathValue("formID")
	if !validID(id) || formID == "" {
		writeError(w, http.StatusBadRequest, "invalid form")
		return
	}
	in, err := decodeJSON[struct {
		Answer map[string]any `json:"answer"`
	}](w, r)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	path := "/api/session/" + url.PathEscape(id) + "/form/" + url.PathEscape(formID) + "/reply"
	if err := c.Do(r.Context(), http.MethodPost, path, map[string]any{"answer": in.Answer}, nil); err != nil {
		s.upstreamError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) cancelForm(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	formID := r.PathValue("formID")
	if !validID(id) || formID == "" {
		writeError(w, http.StatusBadRequest, "invalid form")
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	path := "/api/session/" + url.PathEscape(id) + "/form/" + url.PathEscape(formID)
	if message := strings.TrimSpace(r.URL.Query().Get("message")); message != "" {
		path += "?message=" + url.QueryEscape(message)
	}
	if err := c.Do(r.Context(), http.MethodDelete, path, nil, nil); err != nil {
		s.upstreamError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) grammarCheck(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Text string `json:"text"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	text := strings.TrimSpace(body.Text)
	if text == "" {
		writeError(w, http.StatusBadRequest, "text is empty")
		return
	}
	if utf8.RuneCountInString(text) > maxGrammarText {
		writeError(w, http.StatusRequestEntityTooLarge, "text is too long")
		return
	}
	matches, err := s.grammar.check(r.Context(), text)
	if err != nil {
		s.log.Warn("grammar check failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, "grammar check unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"matches": matches})
}

func (s *Server) stt(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(io.LimitReader(r.Body, maxSTTBody+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read audio")
		return
	}
	if len(data) == 0 {
		writeError(w, http.StatusBadRequest, "audio is empty")
		return
	}
	if len(data) > maxSTTBody {
		writeError(w, http.StatusRequestEntityTooLarge, "audio is too large")
		return
	}
	var text string
	if r.URL.Query().Get("mode") == "fast" {
		text, err = s.fast.transcribe(r.Context(), data)
	} else {
		text, err = transcribe(r.Context(), data)
	}
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"text": text})
}

func transcribe(ctx context.Context, data []byte) (string, error) {
	file, err := os.CreateTemp("", "nit-gui-stt-*.wav")
	if err != nil {
		return "", err
	}
	path := file.Name()
	defer os.Remove(path)
	if _, err := file.Write(data); err != nil {
		file.Close()
		return "", err
	}
	if err := file.Close(); err != nil {
		return "", err
	}
	bin := strings.TrimSpace(os.Getenv("NIT_GUI_WHISPER"))
	if bin == "" {
		bin, err = exec.LookPath("whisper-cli")
		if err != nil {
			return "", fmt.Errorf("whisper-cli not found on the nit-gui host")
		}
	}
	model := strings.TrimSpace(os.Getenv("NIT_GUI_WHISPER_MODEL"))
	if model == "" {
		home, _ := os.UserHomeDir()
		model = filepath.Join(home, ".local/share/whisper/ggml-large-v3-turbo-q5_0.bin")
	}
	if _, err := os.Stat(model); err != nil {
		return "", fmt.Errorf("whisper model not found: %s", model)
	}
	lang := strings.TrimSpace(os.Getenv("NIT_GUI_STT_LANG"))
	if lang == "" {
		lang = "ru"
	}
	runCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(runCtx, bin, "-m", model, "-l", lang, "-nt", "-t", "12",
		"-sns", "--prompt", fastSTTPrompt, "-f", path)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("whisper: %s", message)
	}
	return parseTranscription(stdout.String()), nil
}

func parseTranscription(out string) string {
	lines := make([]string, 0, 8)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "[") || strings.HasPrefix(line, "(") {
			continue
		}
		if strings.HasPrefix(line, "whisper_") || strings.HasPrefix(line, "system_info") ||
			strings.HasPrefix(line, "main:") || strings.HasPrefix(line, "ggml_") {
			continue
		}
		low := strings.ToLower(strings.Trim(line, " .,!…"))
		if strings.HasPrefix(low, "продолжение следует") ||
			strings.HasPrefix(low, "редактор субтитров") ||
			strings.HasPrefix(low, "субтитры сделал") ||
			strings.HasPrefix(low, "субтитры делал") ||
			strings.HasPrefix(low, "корректор ") ||
			strings.HasPrefix(low, "добро пожаловать на наш канал") ||
			strings.HasPrefix(low, "спасибо за просмотр") ||
			strings.HasPrefix(low, "thank you for watching") {
			continue
		}
		lines = append(lines, line)
	}
	return strings.TrimSpace(strings.Join(lines, " "))
}

func (s *Server) config(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	var loc struct {
		Directory string `json:"directory"`
	}
	if err := c.Do(r.Context(), http.MethodGet, "/api/location", nil, &loc); err != nil {
		s.upstreamError(w, err)
		return
	}
	var def struct {
		Data *modelOut `json:"data"`
	}
	_ = c.Do(r.Context(), http.MethodGet, "/api/model/default", nil, &def)
	var agents struct {
		Data []agentOut `json:"data"`
	}
	_ = c.Do(r.Context(), http.MethodGet, "/api/agent", nil, &agents)
	agent := ""
	for _, a := range agents.Data {
		if a.Hidden || (a.Mode != "primary" && a.Mode != "all") {
			continue
		}
		if a.ID == "build" {
			agent = a.ID
			break
		}
		if agent == "" {
			agent = a.ID
		}
	}
	var model *opencode.ModelRef
	if def.Data != nil && def.Data.ID != "" && def.Data.ProviderID != "" {
		model = &opencode.ModelRef{ID: def.Data.ID, ProviderID: def.Data.ProviderID}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"directory": loc.Directory,
		"model":     model,
		"agent":     agent,
	})
}

func (s *Server) projects(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodGet, "/api/project", nil, &raw); err != nil {
		s.upstreamError(w, err)
		return
	}
	writeRaw(w, raw, c.Redactor())
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	resp, err := c.Stream(r.Context(), "/api/event")
	if err != nil {
		s.upstreamError(w, err)
		return
	}
	defer resp.Body.Close()
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	buf := make([]byte, 32<<10)
	redactor := c.Redactor()
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(buf, 64<<20)
	for scanner.Scan() {
		line := scanner.Bytes()
		if payload, ok := bytes.CutPrefix(line, []byte("data:")); ok {
			payload = bytes.TrimPrefix(payload, []byte(" "))
			line = append([]byte("data: "), redactor.JSON(payload)...)
		}
		if _, werr := w.Write(append(line, '\n')); werr != nil {
			return
		}
		flusher.Flush()
	}
}

func (s *Server) staticFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	if !fs.ValidPath(name) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if info, err := fs.Stat(s.static, name); err == nil && !info.IsDir() {
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		http.ServeFileFS(w, r, s.static, name)
		return
	}
	if _, err := fs.Stat(s.static, "index.html"); err != nil {
		writeError(w, http.StatusServiceUnavailable, "frontend bundle not built")
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFileFS(w, r, s.static, "index.html")
}

func (s *Server) upstreamError(w http.ResponseWriter, err error) {
	var he *opencode.HTTPError
	if errors.As(err, &he) {
		var body struct {
			Tag     string `json:"_tag"`
			Message string `json:"message"`
		}
		message := "OpenCode request failed"
		if json.Unmarshal(he.Body, &body) == nil && body.Message != "" {
			message = body.Message
		}
		writeError(w, he.Status, message)
		return
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		writeError(w, http.StatusGatewayTimeout, "OpenCode service timed out")
		return
	}
	s.provider.Drop()
	writeError(w, http.StatusBadGateway, "OpenCode service unavailable")
}

func validID(id string) bool {
	if id == "" || len(id) > 200 {
		return false
	}
	for _, r := range id {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			continue
		}
		return false
	}
	return true
}

type decodeError struct {
	msg    string
	status int
}

func (e *decodeError) Error() string { return e.msg }

func writeDecodeError(w http.ResponseWriter, err error) {
	var de *decodeError
	if errors.As(err, &de) {
		writeError(w, de.status, de.msg)
		return
	}
	writeError(w, http.StatusBadRequest, "invalid JSON body")
}

func decodeJSON[T any](w http.ResponseWriter, r *http.Request) (T, error) {
	var out T
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		return out, &decodeError{msg: "content type must be application/json", status: http.StatusBadRequest}
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&out); err != nil {
		return out, decodeBodyError(err)
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return out, &decodeError{msg: "body must contain one JSON object", status: http.StatusBadRequest}
	}
	return out, nil
}

func decodeBodyError(err error) *decodeError {
	var maxErr *http.MaxBytesError
	if errors.As(err, &maxErr) {
		return &decodeError{msg: "request body too large", status: http.StatusRequestEntityTooLarge}
	}
	if errors.Is(err, io.EOF) {
		return &decodeError{msg: "request body is required", status: http.StatusBadRequest}
	}
	return &decodeError{msg: "invalid JSON body", status: http.StatusBadRequest}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeRaw(w http.ResponseWriter, raw json.RawMessage, redactor *opencode.Redactor) {
	if len(raw) == 0 {
		raw = json.RawMessage(`{}`)
	}
	raw = redactor.JSON(raw)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
