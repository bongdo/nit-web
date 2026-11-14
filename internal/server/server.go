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
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"nitgui/internal/drop"
	"nitgui/internal/opencode"
	"nitgui/internal/uistate"
)

const maxJSONBody = 1 << 20

type ClientProvider interface {
	Client(context.Context) (*opencode.Client, error)
	Drop()
}

type MultiProvider interface {
	ClientFor(context.Context, string) (*opencode.Client, error)
	DropFor(string)
	Instances() []opencode.InstanceSpec
	DefaultInstance() string
	ConfigError() string
	Connected(string) bool
	LastError(string) string
	Transport(string) string
	Detail(string) string
	ConfigPath() string
	HasInstance(string) bool
	Replace([]opencode.InstanceSpec) error
}

type singleProvider struct {
	provider ClientProvider
}

func (p singleProvider) ClientFor(ctx context.Context, name string) (*opencode.Client, error) {
	if name != "local" {
		return nil, opencode.ErrUnknownInstance
	}
	return p.provider.Client(ctx)
}

func (p singleProvider) DropFor(name string) {
	if name == "local" {
		p.provider.Drop()
	}
}

func (p singleProvider) Instances() []opencode.InstanceSpec {
	return []opencode.InstanceSpec{{Name: "local"}}
}

func (p singleProvider) DefaultInstance() string { return "local" }
func (p singleProvider) ConfigError() string     { return "" }
func (p singleProvider) Connected(string) bool   { return true }
func (p singleProvider) LastError(string) string { return "" }
func (p singleProvider) Transport(string) string { return "local" }
func (p singleProvider) Detail(string) string    { return "local" }
func (p singleProvider) ConfigPath() string      { return "" }

func (p singleProvider) HasInstance(name string) bool { return name == "local" }

func (p singleProvider) Replace([]opencode.InstanceSpec) error {
	return errors.New("instance editing is not available")
}

type Server struct {
	multi        MultiProvider
	static       fs.FS
	log          *slog.Logger
	mux          *http.ServeMux
	grammar      *grammarChecker
	tts          *ttsHub
	voice        *hostVoice
	auth         *authGate
	ui           *uistate.Store
	basePath     string
	publicHost   string
	peroURL      string
	termURL      string
	dropManager  http.Handler
	dropPublic   http.Handler
	allowedHosts map[string]struct{}
}

func New(provider ClientProvider, static fs.FS, log *slog.Logger) http.Handler {
	if log == nil {
		log = slog.Default()
	}
	multi, ok := provider.(MultiProvider)
	if !ok {
		multi = singleProvider{provider: provider}
	}
	ui, err := uistate.Open(uistate.DefaultPath(), multi.DefaultInstance())
	if err != nil {
		log.Warn("ui state load failed", "error", err)
	}
	s := &Server{
		multi:        multi,
		static:       static,
		log:          log,
		mux:          http.NewServeMux(),
		grammar:      newGrammarChecker(log),
		tts:          newTTSHub(),
		voice:        newHostVoice(),
		auth:         newAuthGate(log),
		ui:           ui,
		basePath:     strings.TrimRight(os.Getenv("NIT_GUI_BASE_PATH"), "/"),
		publicHost:   strings.TrimSuffix(strings.ToLower(strings.TrimSpace(os.Getenv("NIT_GUI_PUBLIC_HOST"))), "."),
		peroURL:      appURL("NIT_GUI_PERO_URL", "/pero/"),
		termURL:      appURL("NIT_GUI_TERM_URL", "/term/"),
		allowedHosts: map[string]struct{}{},
	}
	for _, host := range strings.Split(os.Getenv("NIT_GUI_ALLOWED_HOSTS"), ",") {
		if host = strings.ToLower(strings.TrimSpace(host)); host != "" {
			s.allowedHosts[host] = struct{}{}
		}
	}
	if store, err := drop.Open(drop.DefaultRoot()); err != nil {
		log.Error("drop store unavailable", "error", err)
	} else {
		services := drop.NewServices(store)
		services.SetBasePath(s.basePath)
		s.dropManager = drop.NewManager(store, services, s.dropWriteAllowed, log, s.peroURL, s.basePath)
		s.dropPublic = drop.NewPublic(store, s.dropReadAllowed, log, s.basePath, services)
		go services.Restore(context.Background())
	}
	s.routes()
	go s.warm()
	return s.middleware(s.auth.wrap(s.instanceGuard(s.mux)))
}

func (s *Server) instanceGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") ||
			strings.HasPrefix(r.URL.Path, "/api/instances") {
			next.ServeHTTP(w, r)
			return
		}
		if name := instanceID(r); name != "" && !s.multi.HasInstance(name) {
			writeError(w, http.StatusBadRequest, "unknown instance")
			return
		}
		next.ServeHTTP(w, r)
	})
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
	if s.voice != nil && s.voice.worker != nil {
		go func() {
			if err := s.voice.warm(); err != nil {
				s.log.Debug("host voice warmup skipped", "error", err)
				return
			}
			s.log.Info("host voice ready", "engine", s.voice.engine, "rate", s.voice.rateHz())
		}()
	}
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.health)
	s.mux.HandleFunc("GET /api/instances", s.instances)
	s.mux.HandleFunc("POST /api/instances", s.saveInstance)
	s.mux.HandleFunc("DELETE /api/instances/{id}", s.deleteInstance)
	s.mux.HandleFunc("GET /api/config", s.config)
	s.mux.HandleFunc("GET /api/projects", s.projects)
	s.mux.HandleFunc("GET /api/fs", s.folders)
	s.mux.HandleFunc("GET /api/sessions", s.sessions)
	s.mux.HandleFunc("GET /api/sessions/{id}", s.session)
	s.mux.HandleFunc("POST /api/sessions", s.createSession)
	s.mux.HandleFunc("DELETE /api/sessions/{id}", s.deleteSession)
	s.mux.HandleFunc("GET /api/sessions/{id}/messages", s.messages)
	s.mux.HandleFunc("GET /api/sessions/{id}/messages/{messageID}", s.message)
	s.mux.HandleFunc("GET /api/sessions/{id}/children", s.children)
	s.mux.HandleFunc("POST /api/sessions/{id}/prompt", s.prompt)
	s.mux.HandleFunc("POST /api/sessions/{id}/interrupt", s.interrupt)
	s.mux.HandleFunc("POST /api/sessions/{id}/revert", s.revert)
	s.mux.HandleFunc("POST /api/sessions/{id}/fork", s.fork)
	s.mux.HandleFunc("POST /api/sessions/{id}/compact", s.compact)
	s.mux.HandleFunc("POST /api/tts", s.ttsSay)
	s.mux.HandleFunc("POST /api/tts/audio", s.ttsAudio)
	s.mux.HandleFunc("POST /api/tts/stream", s.ttsStream)
	s.mux.HandleFunc("POST /api/tts/stop", s.ttsStop)
	s.mux.HandleFunc("POST /api/grammar", s.grammarCheck)
	s.mux.HandleFunc("POST /api/upload", s.upload)
	s.mux.HandleFunc("GET /api/file", s.file)
	s.mux.HandleFunc("GET /api/review", s.review)
	s.mux.HandleFunc("GET /api/doc", s.doc)
	s.mux.HandleFunc("GET /api/sessions/{id}/form", s.forms)
	s.mux.HandleFunc("POST /api/sessions/{id}/form/{formID}/reply", s.replyForm)
	s.mux.HandleFunc("DELETE /api/sessions/{id}/form/{formID}", s.cancelForm)
	s.mux.HandleFunc("GET /api/sessions/{id}/permissions", s.permissions)
	s.mux.HandleFunc("POST /api/sessions/{id}/permissions/{requestID}/reply", s.replyPermission)
	s.mux.HandleFunc("POST /api/sessions/{id}/model", s.switchModel)
	s.mux.HandleFunc("POST /api/sessions/{id}/agent", s.switchAgent)
	s.mux.HandleFunc("GET /api/models", s.models)
	s.mux.HandleFunc("GET /api/agents", s.agents)
	s.mux.HandleFunc("GET /api/ui", s.uiState)
	s.mux.HandleFunc("POST /api/ui/hidden", s.setHidden)
	s.mux.HandleFunc("GET /api/ui/drafts", s.getDraft)
	s.mux.HandleFunc("POST /api/ui/drafts", s.setDraft)
	s.mux.HandleFunc("POST /api/ui/model", s.setModel)
	s.mux.HandleFunc("POST /api/ui/agent", s.setAgent)
	s.mux.HandleFunc("POST /api/ui/sessions/{id}/status", s.setSessionStatus)
	s.mux.HandleFunc("DELETE /api/ui/sessions/{id}", s.removeSessionState)
	s.mux.HandleFunc("GET /api/events", s.events)
	s.mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})
	s.mux.HandleFunc("POST /auth/logout", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/", http.StatusSeeOther)
	})
	s.mux.HandleFunc("GET /drop", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, s.basePath+"/drop/", http.StatusTemporaryRedirect)
	})
	if s.dropManager != nil {
		s.mux.Handle("/drop/", s.dropManager)
	} else {
		s.mux.HandleFunc("/drop/", func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusServiceUnavailable, "drop is unavailable")
		})
	}
	if s.dropPublic != nil {
		s.mux.Handle("/d/", s.dropPublic)
	} else {
		s.mux.HandleFunc("/d/", func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusServiceUnavailable, "drop is unavailable")
		})
	}
	s.mux.HandleFunc("/", s.staticFile)
}

func (s *Server) dropWriteAllowed(r *http.Request) bool {
	if r.Header.Get("Origin") == "null" {
		return false
	}
	return s.allowedOrigin(r)
}

func (s *Server) dropReadAllowed(r *http.Request) bool {
	return !s.auth.enabled || s.auth.authenticated(r)
}

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.basePath != "" {
			if r.URL.Path == s.basePath {
				r.URL.Path = "/"
			} else if strings.HasPrefix(r.URL.Path, s.basePath+"/") {
				r.URL.Path = strings.TrimPrefix(r.URL.Path, s.basePath)
			}
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		if s.auth.secure(r) {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		if !s.allowedHost(forwardedHost(r)) {
			s.log.Warn("host rejected", "host", r.Host, "forwarded_host", r.Header.Get("X-Forwarded-Host"))
			writeError(w, http.StatusForbidden, "host not allowed")
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && !s.allowedOrigin(r) {
			s.log.Warn("origin rejected", "host", r.Host, "forwarded_host", r.Header.Get("X-Forwarded-Host"), "origin", r.Header.Get("Origin"), "public_host", s.publicHost)
			writeError(w, http.StatusForbidden, "origin not allowed")
			return
		}
		switch {
		case r.URL.Path == "/api/events", r.URL.Path == "/api/file",
			r.URL.Path == "/api/tts/audio", r.URL.Path == "/api/tts/stream",
			r.URL.Path == "/drop/api/upload", strings.HasPrefix(r.URL.Path, "/d/"):
		default:
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
	host = strings.TrimSuffix(strings.Trim(host, "[]"), ".")
	if strings.EqualFold(host, "localhost") || host == "127.0.0.1" || host == "::1" {
		return true
	}
	_, ok := s.allowedHosts[strings.ToLower(host)]
	return ok
}

func (s *Server) allowedOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	if origin == "null" {
		if r.Method == http.MethodPost && (r.URL.Path == "/auth" || r.URL.Path == s.basePath+"/auth") {
			return true
		}
		return s.auth.authenticated(r)
	}
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	originHost := hostOnly(u.Host)
	if strings.EqualFold(originHost, hostOnly(forwardedHost(r))) {
		return true
	}
	return s.publicHost != "" && strings.EqualFold(originHost, s.publicHost)
}

func forwardedHost(r *http.Request) string {
	if host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); host != "" {
		return host
	}
	return r.Host
}

func instanceID(r *http.Request) string {
	if value := strings.TrimSpace(r.Header.Get("X-Nit-Instance")); value != "" {
		return value
	}
	return strings.TrimSpace(r.URL.Query().Get("instance"))
}

func (s *Server) instanceName(r *http.Request) string {
	if name := instanceID(r); name != "" {
		return name
	}
	return s.multi.DefaultInstance()
}

func (s *Server) client(r *http.Request) (*opencode.Client, error) {
	return s.multi.ClientFor(r.Context(), s.instanceName(r))
}

func (s *Server) withClient(w http.ResponseWriter, r *http.Request) (*opencode.Client, bool) {
	c, err := s.client(r)
	if err != nil {
		if errors.Is(err, opencode.ErrUnknownInstance) {
			writeError(w, http.StatusBadRequest, "unknown instance")
			return nil, false
		}
		writeError(w, http.StatusServiceUnavailable, "opencode service not found")
		return nil, false
	}
	return c, true
}

func (s *Server) drop(r *http.Request) {
	s.multi.DropFor(s.instanceName(r))
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	c, err := s.client(r)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":       false,
			"instance": s.instanceName(r),
			"error":    err.Error(),
		})
		return
	}
	var info struct {
		Version string `json:"version"`
	}
	if err := c.Do(r.Context(), http.MethodGet, "/api/info", nil, &info); err != nil {
		s.drop(r)
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":       false,
			"instance": s.instanceName(r),
			"server":   c.BaseURL,
			"error":    err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"instance": s.instanceName(r),
		"server":   c.BaseURL,
		"version":  info.Version,
	})
}

func (s *Server) sessions(w http.ResponseWriter, r *http.Request) {
	c, ok := s.withClient(w, r)
	if !ok {
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
	if cursor := strings.TrimSpace(r.URL.Query().Get("cursor")); cursor != "" {
		q.Set("cursor", cursor)
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodGet, "/api/session?"+q.Encode(), nil, &raw); err != nil {
		s.upstreamError(w, r, err)
		return
	}
	writeRaw(w, raw, c.Redactor())
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodGet, "/api/session/"+url.PathEscape(id), nil, &raw); err != nil {
		s.upstreamError(w, r, err)
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
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	dir := strings.TrimSpace(in.Directory)
	if dir == "" {
		var loc struct {
			Directory string `json:"directory"`
		}
		if err := c.Do(r.Context(), http.MethodGet, "/api/location", nil, &loc); err != nil {
			s.upstreamError(w, r, err)
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
		s.upstreamError(w, r, err)
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
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	if err := c.Do(r.Context(), http.MethodDelete, "/api/session/"+url.PathEscape(id), nil, nil); err != nil {
		s.upstreamError(w, r, err)
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
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	limit := 0
	if value := r.URL.Query().Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 {
			writeError(w, http.StatusBadRequest, "invalid limit")
			return
		}
		if parsed > 200 {
			parsed = 200
		}
		limit = parsed
	}
	before := r.URL.Query().Get("before")
	light := r.URL.Query().Get("light") == "1"
	redactor := c.Redactor()
	pages := []json.RawMessage{}
	previous := ""
	if limit > 0 {
		query := url.Values{}
		query.Set("limit", strconv.Itoa(limit))
		if before != "" {
			query.Set("cursor", before)
		} else {
			query.Set("order", "desc")
		}
		raw, err := c.Raw(r.Context(), http.MethodGet, fmt.Sprintf("/api/session/%s/message?%s", url.PathEscape(id), query.Encode()))
		if err != nil {
			s.upstreamError(w, r, err)
			return
		}
		data, next, _, err := decodeMessagesPage(raw)
		if err != nil {
			s.upstreamError(w, r, err)
			return
		}
		if len(data) > 0 {
			if light {
				data, err = lightenTranscript(data)
				if err != nil {
					writeError(w, http.StatusBadGateway, "OpenCode returned an invalid transcript")
					return
				}
			}
			var count int
			data, count, err = reverseTranscript(data)
			if err != nil {
				writeError(w, http.StatusBadGateway, "OpenCode returned an invalid transcript")
				return
			}
			if count >= limit {
				previous = next
			}
			pages = append(pages, redactor.JSON(data))
		}
	} else {
		cursor := ""
		for page := 0; page < 100; page++ {
			path := fmt.Sprintf("/api/session/%s/message?order=asc&limit=100", url.PathEscape(id))
			if cursor != "" {
				path = fmt.Sprintf("/api/session/%s/message?limit=100&cursor=%s", url.PathEscape(id), url.QueryEscape(cursor))
			}
			raw, err := c.Raw(r.Context(), http.MethodGet, path)
			if err != nil {
				s.upstreamError(w, r, err)
				return
			}
			data, next, _, err := decodeMessagesPage(raw)
			if err != nil {
				s.upstreamError(w, r, err)
				return
			}
			if len(data) == 0 {
				break
			}
			if light {
				data, err = lightenTranscript(data)
				if err != nil {
					writeError(w, http.StatusBadGateway, "OpenCode returned an invalid transcript")
					return
				}
			}
			pages = append(pages, redactor.JSON(data))
			if next == "" {
				break
			}
			cursor = next
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"data":[`))
	wrote := false
	for _, page := range pages {
		body := bytes.TrimSpace(page)
		if len(body) < 2 || body[0] != '[' || body[len(body)-1] != ']' {
			continue
		}
		body = bytes.TrimSpace(body[1 : len(body)-1])
		if len(body) == 0 {
			continue
		}
		if wrote {
			_, _ = w.Write([]byte(","))
		}
		wrote = true
		if _, err := w.Write(body); err != nil {
			return
		}
	}
	_, _ = w.Write([]byte(`]`))
	if previous != "" {
		encoded, _ := json.Marshal(previous)
		_, _ = w.Write([]byte(`,"previous":`))
		_, _ = w.Write(encoded)
	} else {
		_, _ = w.Write([]byte(`,"previous":null`))
	}
	_, _ = w.Write([]byte(`}`))
}

func decodeMessagesPage(raw []byte) (json.RawMessage, string, string, error) {
	var env struct {
		Data   json.RawMessage `json:"data"`
		Cursor struct {
			Next     *string `json:"next"`
			Previous *string `json:"previous"`
		} `json:"cursor"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, "", "", err
	}
	data := bytes.TrimSpace(env.Data)
	if len(data) == 0 || bytes.Equal(data, []byte("null")) {
		data = nil
	} else if data[0] != '[' {
		return nil, "", "", fmt.Errorf("OpenCode returned an invalid transcript")
	}
	next, prev := "", ""
	if env.Cursor.Next != nil {
		next = *env.Cursor.Next
	}
	if env.Cursor.Previous != nil {
		prev = *env.Cursor.Previous
	}
	return data, next, prev, nil
}

func reverseTranscript(data []byte) ([]byte, int, error) {
	var messages []json.RawMessage
	if err := json.Unmarshal(data, &messages); err != nil {
		return nil, 0, err
	}
	for left, right := 0, len(messages)-1; left < right; left, right = left+1, right-1 {
		messages[left], messages[right] = messages[right], messages[left]
	}
	encoded, err := json.Marshal(messages)
	return encoded, len(messages), err
}

func (s *Server) message(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	messageID := r.PathValue("messageID")
	if !validID(id) || !validID(messageID) {
		writeError(w, http.StatusBadRequest, "invalid message id")
		return
	}
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	path := fmt.Sprintf("/api/session/%s/message/%s", url.PathEscape(id), url.PathEscape(messageID))
	raw, err := c.Raw(r.Context(), http.MethodGet, path)
	if err != nil {
		s.upstreamError(w, r, err)
		return
	}
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		s.upstreamError(w, r, err)
		return
	}
	data := bytes.TrimSpace(env.Data)
	if len(data) == 0 || bytes.Equal(data, []byte("null")) {
		writeError(w, http.StatusNotFound, "message not found")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"data":`))
	_, _ = w.Write(c.Redactor().JSON(data))
	_, _ = w.Write([]byte(`}`))
}

func (s *Server) children(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	q := url.Values{}
	q.Set("limit", "100")
	q.Set("order", "desc")
	q.Set("archived", "false")
	q.Set("parentID", id)
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodGet, "/api/session?"+q.Encode(), nil, &raw); err != nil {
		s.upstreamError(w, r, err)
		return
	}
	writeRaw(w, raw, c.Redactor())
}

type promptFile struct {
	URI  string `json:"uri"`
	Name string `json:"name,omitempty"`
}

type promptInput struct {
	ID       string       `json:"id,omitempty"`
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
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	body := map[string]any{"text": in.Text}
	if in.ID != "" {
		body["id"] = in.ID
	}
	if len(in.Files) > 0 {
		body["files"] = in.Files
	}
	if in.Delivery == "queue" || in.Delivery == "steer" {
		body["delivery"] = in.Delivery
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodPost, "/api/session/"+url.PathEscape(id)+"/prompt", body, &raw); err != nil {
		s.upstreamError(w, r, err)
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
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodPost, "/api/session/"+url.PathEscape(id)+"/interrupt", nil, &raw); err != nil {
		s.upstreamError(w, r, err)
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
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	path := "/api/session/" + url.PathEscape(id) + "/revert"
	if err := c.Do(r.Context(), http.MethodPost, path+"/stage", map[string]any{"messageID": in.MessageID, "files": false}, nil); err != nil {
		s.upstreamError(w, r, err)
		return
	}
	if err := c.Do(r.Context(), http.MethodPost, path+"/commit", map[string]any{}, nil); err != nil {
		s.upstreamError(w, r, err)
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
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	body := map[string]any{}
	if in.Before != "" {
		body["before"] = in.Before
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodPost, "/api/session/"+url.PathEscape(id)+"/fork", body, &raw); err != nil {
		s.upstreamError(w, r, err)
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
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	if err := c.Do(r.Context(), http.MethodPost, "/api/session/"+url.PathEscape(id)+"/compact", map[string]any{}, nil); err != nil {
		s.upstreamError(w, r, err)
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
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodPost, "/api/session/"+url.PathEscape(id)+"/model", map[string]any{"model": in.Model}, &raw); err != nil {
		s.upstreamError(w, r, err)
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
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodPost, "/api/session/"+url.PathEscape(id)+"/agent", map[string]string{"agent": strings.TrimSpace(in.Agent)}, &raw); err != nil {
		s.upstreamError(w, r, err)
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
		Tier *struct {
			Type string `json:"type"`
			Size int    `json:"size"`
		} `json:"tier,omitempty"`
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
	c, ok := s.withClient(w, r)
	if !ok {
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
		s.upstreamError(w, r, err)
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
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	var env struct {
		Data []agentOut `json:"data"`
	}
	if err := c.Do(r.Context(), http.MethodGet, "/api/agent", nil, &env); err != nil {
		s.upstreamError(w, r, err)
		return
	}
	if env.Data == nil {
		env.Data = []agentOut{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": env.Data})
}

const maxUploadBody = 20 << 20

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

func inlineFileType(contentType string) bool {
	if strings.HasPrefix(contentType, "text/plain") ||
		strings.HasPrefix(contentType, "audio/") ||
		strings.HasPrefix(contentType, "video/") {
		return true
	}
	switch contentType {
	case "application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp":
		return true
	}
	return false
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
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	path := filepath.Join(os.TempDir(), fmt.Sprintf("nit-gui-%d-%s", time.Now().UnixNano(), safeUploadName(name)))
	saved, err := c.WriteFile(r.Context(), dir, path, data)
	if err != nil {
		s.upstreamError(w, r, err)
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
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	body, err := c.ReadFile(r.Context(), path)
	if err != nil {
		s.upstreamError(w, r, err)
		return
	}
	defer body.Body.Close()
	contentType := mime.TypeByExtension(filepath.Ext(path))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	if contentType == "application/pdf" {
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	}
	if !inlineFileType(contentType) {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{
			"filename": filepath.Base(path),
		}))
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	if _, err := io.Copy(w, body.Body); err != nil {
		s.log.Warn("file stream failed", "path", path, "error", err)
	}
}

type reviewItem struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Status  string `json:"status"`
	Title   string `json:"title"`
	Quote   string `json:"quote"`
	Source  string `json:"source"`
	Note    string `json:"note"`
	Body    string `json:"body"`
	Created int64  `json:"created"`
}

type reviewQueue struct {
	Updated int64        `json:"updated"`
	Items   []reviewItem `json:"items"`
}

func reviewPath(dir string) (string, bool) {
	if dir == "" || !filepath.IsAbs(dir) {
		return "", false
	}
	return filepath.Join(filepath.Clean(dir), "docs", "review", "queue.json"), true
}

func docPath(dir, rel string) (string, bool) {
	if dir == "" || !filepath.IsAbs(dir) || rel == "" || filepath.IsAbs(rel) {
		return "", false
	}
	clean := filepath.Clean(rel)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", false
	}
	if !strings.HasPrefix(clean, "vault"+string(filepath.Separator)) &&
		!strings.HasPrefix(clean, "docs"+string(filepath.Separator)) {
		return "", false
	}
	return filepath.Join(filepath.Clean(dir), clean), true
}

func (s *Server) review(w http.ResponseWriter, r *http.Request) {
	path, ok := reviewPath(r.URL.Query().Get("dir"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid directory")
		return
	}
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	body, err := c.ReadFile(r.Context(), path)
	if err != nil {
		var httpErr *opencode.HTTPError
		if errors.As(err, &httpErr) && httpErr.Status == http.StatusNotFound {
			writeJSON(w, http.StatusOK, reviewQueue{Items: []reviewItem{}})
			return
		}
		s.upstreamError(w, r, err)
		return
	}
	defer body.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(body.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadGateway, "could not read review queue")
		return
	}
	var queue reviewQueue
	if err := json.Unmarshal(raw, &queue); err != nil {
		writeError(w, http.StatusBadGateway, "invalid review queue")
		return
	}
	if queue.Items == nil {
		queue.Items = []reviewItem{}
	}
	writeJSON(w, http.StatusOK, queue)
}

func (s *Server) doc(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	path, ok := docPath(query.Get("dir"), query.Get("path"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid document path")
		return
	}
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	body, err := c.ReadFile(r.Context(), path)
	if err != nil {
		s.upstreamError(w, r, err)
		return
	}
	defer body.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(body.Body, 512<<10))
	if err != nil {
		writeError(w, http.StatusBadGateway, "could not read document")
		return
	}
	if !utf8.Valid(raw) {
		writeError(w, http.StatusUnsupportedMediaType, "not a text document")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": query.Get("path"), "text": string(raw)})
}

func (s *Server) forms(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodGet, "/api/session/"+url.PathEscape(id)+"/form", nil, &raw); err != nil {
		s.upstreamError(w, r, err)
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
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	path := "/api/session/" + url.PathEscape(id) + "/form/" + url.PathEscape(formID) + "/reply"
	if err := c.Do(r.Context(), http.MethodPost, path, map[string]any{"answer": in.Answer}, nil); err != nil {
		s.upstreamError(w, r, err)
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
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	path := "/api/session/" + url.PathEscape(id) + "/form/" + url.PathEscape(formID)
	if message := strings.TrimSpace(r.URL.Query().Get("message")); message != "" {
		path += "?message=" + url.QueryEscape(message)
	}
	if err := c.Do(r.Context(), http.MethodDelete, path, nil, nil); err != nil {
		s.upstreamError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) ttsSay(w http.ResponseWriter, r *http.Request) {
	if s.tts == nil {
		writeError(w, http.StatusServiceUnavailable, "host TTS not configured")
		return
	}
	var body struct {
		Text string `json:"text"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	clients, err := s.tts.say(r.Context(), body.Text)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "clients": clients})
}

func (s *Server) ttsAudio(w http.ResponseWriter, r *http.Request) {
	if s.voice == nil {
		writeError(w, http.StatusServiceUnavailable, "host voice not configured")
		return
	}
	var body struct {
		Text string `json:"text"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	text, err := ttsText(body.Text)
	if err != nil {
		writeTTSInputError(w, err)
		return
	}
	text = speechText(text)
	if text == "" {
		writeTTSInputError(w, errTTSTextEmpty)
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(hostVoiceTimeout + 5*time.Second))
	audio, contentType, err := s.voice.synthesize(r.Context(), text)
	if err != nil {
		switch {
		case errors.Is(err, errTTSTextLong):
			writeError(w, http.StatusRequestEntityTooLarge, err.Error())
		case errors.Is(err, errTTSTextEmpty):
			writeError(w, http.StatusBadRequest, err.Error())
		default:
			writeError(w, http.StatusServiceUnavailable, err.Error())
		}
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(audio)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(audio)
}

func (s *Server) ttsStream(w http.ResponseWriter, r *http.Request) {
	if s.voice == nil || !s.voice.streamAvailable() {
		writeError(w, http.StatusServiceUnavailable, "host voice streaming not available")
		return
	}
	var body struct {
		Text string `json:"text"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	text, err := ttsText(body.Text)
	if err != nil {
		writeTTSInputError(w, err)
		return
	}
	text = speechText(text)
	if text == "" {
		writeTTSInputError(w, errTTSTextEmpty)
		return
	}
	controller := http.NewResponseController(w)
	_ = controller.SetWriteDeadline(time.Now().Add(hostVoiceTimeout + 5*time.Second))
	w.Header().Set("Content-Type", "audio/L16")
	w.Header().Set("X-Audio-Rate", strconv.Itoa(s.voice.rateHz()))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_ = controller.Flush()
	if err := s.voice.stream(r.Context(), text, flushWriter{w: w, flush: controller.Flush}); err != nil && r.Context().Err() == nil {
		s.log.Warn("tts stream failed", "error", err)
	}
}

func writeTTSInputError(w http.ResponseWriter, err error) {
	if errors.Is(err, errTTSTextLong) {
		writeError(w, http.StatusRequestEntityTooLarge, err.Error())
		return
	}
	writeError(w, http.StatusBadRequest, err.Error())
}

type flushWriter struct {
	w     http.ResponseWriter
	flush func() error
}

func (f flushWriter) Write(p []byte) (int, error) {
	n, err := f.w.Write(p)
	if err == nil {
		_ = f.flush()
	}
	return n, err
}

func (s *Server) ttsStop(w http.ResponseWriter, r *http.Request) {
	if s.tts == nil {
		writeError(w, http.StatusServiceUnavailable, "host TTS not configured")
		return
	}
	_ = s.tts.stop(r.Context())
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

func (s *Server) config(w http.ResponseWriter, r *http.Request) {
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	var loc struct {
		Directory string `json:"directory"`
	}
	if err := c.Do(r.Context(), http.MethodGet, "/api/location", nil, &loc); err != nil {
		s.upstreamError(w, r, err)
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
		"peroURL":   s.peroURL,
		"termURL":   s.termURL,
		"transport": s.multi.Transport(s.instanceName(r)),
	})
}

func appURL(env, fallback string) string {
	raw := strings.TrimSpace(os.Getenv(env))
	if raw == "" {
		return fallback
	}
	if !strings.HasSuffix(raw, "/") {
		raw += "/"
	}
	return raw
}

func (s *Server) projects(w http.ResponseWriter, r *http.Request) {
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	var raw json.RawMessage
	if err := c.Do(r.Context(), http.MethodGet, "/api/project", nil, &raw); err != nil {
		s.upstreamError(w, r, err)
		return
	}
	writeRaw(w, raw, c.Redactor())
}

func (s *Server) uiState(w http.ResponseWriter, r *http.Request) {
	state := s.ui.Snapshot(s.instanceName(r))
	if state.Hidden == nil {
		state.Hidden = []string{}
	}
	if state.Status == nil {
		state.Status = map[string]string{}
	}
	var agent any
	if state.Agent != "" {
		agent = state.Agent
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hidden": state.Hidden,
		"status": state.Status,
		"model":  state.Model,
		"agent":  agent,
	})
}

func (s *Server) setHidden(w http.ResponseWriter, r *http.Request) {
	in, err := decodeJSON[struct {
		IDs    []string `json:"ids"`
		Hidden bool     `json:"hidden"`
	}](w, r)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	if len(in.IDs) > 1000 {
		writeError(w, http.StatusBadRequest, "too many sessions")
		return
	}
	for _, id := range in.IDs {
		if !validID(id) {
			writeError(w, http.StatusBadRequest, "invalid session id")
			return
		}
	}
	if err := s.ui.SetHidden(s.instanceName(r), in.IDs, in.Hidden); err != nil {
		s.log.Error("ui state save failed", "error", err)
		writeError(w, http.StatusInternalServerError, "could not save ui state")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) getDraft(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if !validKey(key) {
		writeError(w, http.StatusBadRequest, "invalid draft key")
		return
	}
	draft := s.ui.Draft(s.instanceName(r), key)
	writeJSON(w, http.StatusOK, map[string]any{
		"text":      draft.Text,
		"cleared":   draft.Cleared,
		"updatedAt": draft.UpdatedAt,
	})
}

func (s *Server) setDraft(w http.ResponseWriter, r *http.Request) {
	in, err := decodeJSON[struct {
		Key  string `json:"key"`
		Text string `json:"text"`
	}](w, r)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	if !validKey(in.Key) {
		writeError(w, http.StatusBadRequest, "invalid draft key")
		return
	}
	if len(in.Text) > 256<<10 {
		writeError(w, http.StatusRequestEntityTooLarge, "draft is too large")
		return
	}
	draft, err := s.ui.SetDraft(s.instanceName(r), in.Key, in.Text)
	if err != nil {
		s.log.Error("ui state save failed", "error", err)
		writeError(w, http.StatusInternalServerError, "could not save ui state")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"updatedAt": draft.UpdatedAt})
}

func (s *Server) setModel(w http.ResponseWriter, r *http.Request) {
	in, err := decodeJSON[struct {
		Model *uistate.ModelRef `json:"model"`
	}](w, r)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	if in.Model != nil {
		if !validLabel(in.Model.ID, 200) || !validLabel(in.Model.ProviderID, 200) ||
			!validLabel(in.Model.Variant, 100) {
			writeError(w, http.StatusBadRequest, "invalid model")
			return
		}
	}
	if err := s.ui.SetModel(s.instanceName(r), in.Model); err != nil {
		s.log.Error("ui state save failed", "error", err)
		writeError(w, http.StatusInternalServerError, "could not save ui state")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) setAgent(w http.ResponseWriter, r *http.Request) {
	in, err := decodeJSON[struct {
		Agent string `json:"agent"`
	}](w, r)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	if !validLabel(in.Agent, 200) {
		writeError(w, http.StatusBadRequest, "invalid agent")
		return
	}
	if err := s.ui.SetAgent(s.instanceName(r), in.Agent); err != nil {
		s.log.Error("ui state save failed", "error", err)
		writeError(w, http.StatusInternalServerError, "could not save ui state")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) setSessionStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	in, err := decodeJSON[struct {
		Status string `json:"status"`
	}](w, r)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	status := strings.TrimSpace(in.Status)
	if status != "" && status != "done" && status != "failed" {
		writeError(w, http.StatusBadRequest, "invalid status")
		return
	}
	if err := s.ui.SetStatus(s.instanceName(r), id, status); err != nil {
		s.log.Error("ui state save failed", "error", err)
		writeError(w, http.StatusInternalServerError, "could not save ui state")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) removeSessionState(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	if err := s.ui.Remove(s.instanceName(r), id); err != nil {
		s.log.Error("ui state save failed", "error", err)
		writeError(w, http.StatusInternalServerError, "could not save ui state")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	resp, err := c.Stream(r.Context(), "/api/event")
	if err != nil {
		s.upstreamError(w, r, err)
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

func (s *Server) upstreamError(w http.ResponseWriter, r *http.Request, err error) {
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
	s.drop(r)
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

func validKey(key string) bool {
	return key != "" && len(key) <= 512 && validLabel(key, 512)
}

func validLabel(value string, limit int) bool {
	if len(value) > limit {
		return false
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return false
		}
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
