package gate

import (
	"context"
	"html/template"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"nitgui/internal/gateid"
)

const (
	sessionCookie = "gate_session"
	sessionTTL    = 7 * 24 * time.Hour
	forwardTTL    = 60 * time.Second
	maxFailures   = 5
	blockTime     = 15 * time.Minute
)

type ctxKey int

const identityKey ctxKey = 1

type Server struct {
	routes  *Routes
	users   *Store
	secret  []byte
	log     *slog.Logger
	now     func() time.Time
	mu      sync.Mutex
	failed  map[string]int
	blocked map[string]time.Time
}

func New(routes *Routes, users *Store, secret []byte, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	return &Server{
		routes:  routes,
		users:   users,
		secret:  secret,
		log:     log,
		now:     time.Now,
		failed:  map[string]int{},
		blocked: map[string]time.Time{},
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.home)
	mux.HandleFunc("GET /login", s.loginPage)
	mux.HandleFunc("POST /login", s.loginSubmit)
	mux.HandleFunc("POST /logout", s.logout)
	mux.HandleFunc("GET /signup", s.signupPage)
	mux.HandleFunc("POST /signup", s.signupSubmit)
	mux.HandleFunc("GET /account", s.accountPage)
	mux.HandleFunc("POST /account/password", s.accountPassword)
	mux.HandleFunc("GET /admin", s.adminPage)
	mux.HandleFunc("POST /admin/approve", s.adminApprove)
	mux.HandleFunc("POST /admin/reject", s.adminReject)
	mux.HandleFunc("GET /i/{token}", s.invitePage)
	mux.HandleFunc("POST /i/{token}", s.inviteSubmit)
	mux.HandleFunc("/", s.proxy)
	return s.security(mux)
}

func (s *Server) security(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		forwarded := r.Header.Get(gateid.Header)
		r.Header.Del(gateid.Header)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		if id, ok := s.session(r); ok {
			r = r.WithContext(context.WithValue(r.Context(), identityKey, id))
		} else if id, ok := s.serviceIdentity(r, forwarded); ok {
			r = r.WithContext(context.WithValue(r.Context(), identityKey, id))
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) serviceIdentity(r *http.Request, forwarded string) (gateid.Identity, bool) {
	if forwarded == "" || !isLoopback(r.RemoteAddr) {
		return gateid.Identity{}, false
	}
	id, err := gateid.Verify(s.secret, forwarded, s.now())
	if err != nil || id.Anonymous() {
		return gateid.Identity{}, false
	}
	return id, true
}

func isLoopback(remote string) bool {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		host = remote
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

func wantsJSON(r *http.Request) bool {
	if strings.HasPrefix(r.URL.Path, "/i/") || strings.HasPrefix(r.URL.Path, "/api/") {
		return true
	}
	if strings.Contains(strings.ToLower(r.Header.Get("Accept")), "application/json") {
		return true
	}
	return strings.EqualFold(r.Header.Get("X-Requested-With"), "XMLHttpRequest")
}

func writeAuthError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, `{"error":"`+message+`"}`)
}

func identity(r *http.Request) gateid.Identity {
	id, _ := r.Context().Value(identityKey).(gateid.Identity)
	return id
}

func (s *Server) session(r *http.Request) (gateid.Identity, bool) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return gateid.Identity{}, false
	}
	id, err := gateid.Verify(s.secret, cookie.Value, s.now())
	if err != nil || id.Anonymous() {
		return gateid.Identity{}, false
	}
	return id, true
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, user User) {
	id := gateid.Identity{
		User: user.Name,
		Role: user.Role,
		Caps: gateid.Caps(user.Role),
		Exp:  s.now().Add(sessionTTL).Unix(),
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    gateid.Sign(s.secret, id),
		Path:     "/",
		MaxAge:   int(sessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   s.secure(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) stopSession(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.secure(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) secure(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func (s *Server) proxy(w http.ResponseWriter, r *http.Request) {
	id := identity(r)
	route, ok := s.routes.Match(r.URL.Path)
	if !ok {
		s.notFound(w, r)
		return
	}
	if !route.Optional && !id.Has(route.Cap) {
		if !id.Anonymous() {
			s.forbidden(w, r, route)
			return
		}
		if wantsJSON(r) {
			writeAuthError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		http.Redirect(w, r, "/login?next="+url.QueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
		return
	}
	target, err := url.Parse(route.Upstream)
	if err != nil {
		s.log.Error("bad upstream", "route", route.Prefix, "error", err)
		http.Error(w, "bad gateway", http.StatusBadGateway)
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		s.log.Warn("upstream failed", "route", route.Prefix, "error", err)
		http.Error(w, "upstream is not running", http.StatusBadGateway)
	}
	director := proxy.Director
	proxy.Director = func(req *http.Request) {
		director(req)
		req.Header.Del(gateid.Header)
		req.Header.Set("X-Forwarded-Host", r.Host)
		if s.secure(r) {
			req.Header.Set("X-Forwarded-Proto", "https")
		} else {
			req.Header.Set("X-Forwarded-Proto", "http")
		}
		if !id.Anonymous() {
			forward := id
			forward.Exp = s.now().Add(forwardTTL).Unix()
			req.Header.Set(gateid.Header, gateid.Sign(s.secret, forward))
		}
	}
	proxy.ServeHTTP(w, r)
}

func (s *Server) blockedIP(r *http.Request) (time.Duration, bool) {
	ip := clientIP(r)
	s.mu.Lock()
	defer s.mu.Unlock()
	until, ok := s.blocked[ip]
	if !ok {
		return 0, false
	}
	if s.now().After(until) {
		delete(s.blocked, ip)
		delete(s.failed, ip)
		return 0, false
	}
	return time.Until(until), true
}

func (s *Server) noteFailure(r *http.Request) {
	ip := clientIP(r)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failed[ip]++
	if s.failed[ip] >= maxFailures {
		s.blocked[ip] = s.now().Add(blockTime)
		s.failed[ip] = 0
	}
}

func (s *Server) resetFailures(r *http.Request) {
	ip := clientIP(r)
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.failed, ip)
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if host == "127.0.0.1" || host == "::1" {
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			for _, part := range strings.Split(forwarded, ",") {
				if ip := strings.TrimSpace(part); ip != "" {
					return ip
				}
			}
		}
	}
	return host
}

func safeNext(raw string) string {
	if raw == "" || !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.HasPrefix(raw, "/\\") {
		return "/"
	}
	for _, r := range raw {
		if r < 0x20 || r == 0x7f || r == '\\' {
			return "/"
		}
	}
	return raw
}

var pages = template.Must(template.New("gate").Parse(pageSource))
