package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"nitgui/internal/opencode"
)

const maxJSONBody = 1 << 20

type ClientProvider interface {
	Client(context.Context) (*opencode.Client, error)
	Drop()
}

type Server struct {
	provider ClientProvider
	static   fs.FS
	log      *slog.Logger
	mux      *http.ServeMux
}

func New(provider ClientProvider, static fs.FS, log *slog.Logger) http.Handler {
	if log == nil {
		log = slog.Default()
	}
	s := &Server{provider: provider, static: static, log: log, mux: http.NewServeMux()}
	s.routes()
	return s.middleware(s.mux)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.health)
	s.mux.HandleFunc("GET /api/config", s.config)
	s.mux.HandleFunc("GET /api/sessions", s.sessions)
	s.mux.HandleFunc("POST /api/sessions", s.createSession)
	s.mux.HandleFunc("GET /api/sessions/{id}/messages", s.messages)
	s.mux.HandleFunc("POST /api/sessions/{id}/prompt", s.prompt)
	s.mux.HandleFunc("POST /api/sessions/{id}/interrupt", s.interrupt)
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
		if !allowedHost(r.Host) {
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

func allowedHost(hostport string) bool {
	if hostport == "" {
		return false
	}
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
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
	q.Set("parentID", "null")
	q.Set("archived", "false")
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
	writeRaw(w, raw)
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
	writeRaw(w, raw)
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
		data = append(data, env.Data...)
		if env.Cursor.Next == nil || *env.Cursor.Next == "" {
			break
		}
		cursor = *env.Cursor.Next
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": data})
}

type promptInput struct {
	Text string `json:"text"`
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
	if strings.TrimSpace(in.Text) == "" {
		writeError(w, http.StatusBadRequest, "text is required")
		return
	}
	c, ok := s.client(r.Context())
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodPost, "/api/session/"+url.PathEscape(id)+"/prompt", map[string]string{"text": in.Text}, &raw); err != nil {
		s.upstreamError(w, err)
		return
	}
	writeRaw(w, raw)
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
	writeRaw(w, raw)
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
	writeRaw(w, raw)
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
	writeRaw(w, raw)
}

type modelOut struct {
	ID         string `json:"id"`
	ModelID    string `json:"modelID"`
	ProviderID string `json:"providerID"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	Enabled    bool   `json:"enabled"`
	Variants   []struct {
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
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return
			}
			flusher.Flush()
		}
		if err != nil {
			return
		}
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

func writeRaw(w http.ResponseWriter, raw json.RawMessage) {
	if len(raw) == 0 {
		raw = json.RawMessage(`{}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
