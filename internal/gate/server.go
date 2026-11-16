package gate

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"

	"nitgui/internal/drop"
	"nitgui/internal/gateid"
)

const (
	sessionCookie = "gate_session"
	deviceCookie  = "gate_device"
	sessionTTL    = 7 * 24 * time.Hour
	deviceTTL     = 365 * 24 * time.Hour
	forwardTTL    = 60 * time.Second
	maxFailures   = 5
	blockTime     = time.Minute
	blockMax      = 15 * time.Minute
	blockForget   = time.Hour
)

type ctxKey int

const identityKey ctxKey = 1

type Server struct {
	routes  *Routes
	users   *Store
	agents  *Agents
	devices *Devices
	audit   *Audit
	drops   *drop.Store
	hub     *agentHub
	qr      *qrStore
	health  healthCache
	secret  []byte
	log     *slog.Logger
	now     func() time.Time
	mu      sync.Mutex
	failed  map[string]int
	blocked map[string]time.Time
	blocks  map[string]int
	last    map[string]time.Time
}

func New(routes *Routes, users *Store, agents *Agents, secret []byte, log *slog.Logger, devices ...*Devices) *Server {
	if log == nil {
		log = slog.Default()
	}
	deviceStore := &Devices{now: time.Now, items: map[string]Device{}}
	switch {
	case len(devices) > 0 && devices[0] != nil:
		deviceStore = devices[0]
	default:
		opened, err := OpenDevices(DefaultDevicesPath())
		if err != nil {
			log.Warn("gate devices unavailable", "error", err)
		} else {
			deviceStore = opened
		}
	}
	return &Server{
		routes:  routes,
		users:   users,
		agents:  agents,
		devices: deviceStore,
		hub:     newAgentHub(),
		qr:      newQRStore(),
		secret:  secret,
		log:     log,
		now:     time.Now,
		failed:  map[string]int{},
		blocked: map[string]time.Time{},
		blocks:  map[string]int{},
		last:    map[string]time.Time{},
	}
}

func (s *Server) SetAudit(audit *Audit) {
	s.audit = audit
}

func (s *Server) SetDrops(store *drop.Store) {
	s.drops = store
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.home)
	mux.HandleFunc("GET /login", s.loginPage)
	mux.HandleFunc("POST /login", s.loginSubmit)
	mux.HandleFunc("POST /logout", s.logout)
	mux.HandleFunc("GET /qr/{code}", s.qrConfirmPage)
	mux.HandleFunc("POST /qr/{code}", s.qrConfirm)
	mux.HandleFunc("GET /qr/{code}/status", s.qrStatus)
	mux.HandleFunc("POST /account/totp/start", s.accountTOTPStart)
	mux.HandleFunc("POST /account/totp/enable", s.accountTOTPEnable)
	mux.HandleFunc("POST /account/totp/disable", s.accountTOTPDisable)
	mux.HandleFunc("GET /signup", s.signupPage)
	mux.HandleFunc("POST /signup", s.signupSubmit)
	mux.HandleFunc("GET /account", s.accountPage)
	mux.HandleFunc("POST /account/password", s.accountPassword)
	mux.HandleFunc("POST /account/devices/remove", s.accountDeviceRemove)
	mux.HandleFunc("GET /admin", s.adminPage)
	mux.HandleFunc("POST /admin/approve", s.adminApprove)
	mux.HandleFunc("POST /admin/reject", s.adminReject)
	mux.HandleFunc("POST /admin/devices/remove", s.adminDeviceRemove)
	mux.HandleFunc("POST /admin/devices/rename", s.adminDeviceRename)
	mux.HandleFunc("POST /account/devices/rename", s.accountDeviceRename)
	mux.HandleFunc("GET /i/{token}", s.invitePage)
	mux.HandleFunc("POST /i/{token}", s.inviteSubmit)
	mux.HandleFunc("GET /agent", s.agentSocket)
	mux.HandleFunc("GET /api/agents", s.machines)
	mux.HandleFunc("GET /preview/{prefix}", s.previewProxy)
	mux.HandleFunc("GET /previews/{name}", s.previewImage)
	mux.HandleFunc("/i/{machine}/{target}", s.instanceProxy)
	mux.HandleFunc("/i/{machine}/{target}/{rest...}", s.instanceProxy)
	mux.HandleFunc("/", s.proxy)
	return s.security(mux)
}

func (s *Server) security(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		forwarded := r.Header.Get(gateid.Header)
		r.Header.Del(gateid.Header)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		if id, ok := s.session(w, r); ok {
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

func (s *Server) session(w http.ResponseWriter, r *http.Request) (gateid.Identity, bool) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return gateid.Identity{}, false
	}
	id, err := gateid.Verify(s.secret, cookie.Value, s.now())
	if err != nil || id.Anonymous() {
		return gateid.Identity{}, false
	}
	if id.Dev != "" {
		if !s.devices.Has(id.User, id.Dev) {
			return gateid.Identity{}, false
		}
		s.devices.Touch(id.Dev, clientIP(r))
		s.ensureAppSession(w, r, !id.Temp)
		return id, true
	}
	if id.Temp {
		s.ensureAppSession(w, r, false)
		return id, true
	}
	if device, err := s.deviceFor(w, r, id.User); err == nil {
		id.Dev = device.ID
		s.setSession(w, r, id, true)
	} else {
		s.log.Warn("gate device add", "error", err)
	}
	s.ensureAppSession(w, r, true)
	return id, true
}

func (s *Server) deviceFor(w http.ResponseWriter, r *http.Request, user string) (Device, error) {
	if cookie, err := r.Cookie(deviceCookie); err == nil && cookie.Value != "" && s.devices.Has(user, cookie.Value) {
		return s.devices.Refresh(cookie.Value, deviceName(r.UserAgent()), clientIP(r))
	}
	device, err := s.devices.Add(user, deviceName(r.UserAgent()), clientIP(r))
	if err != nil {
		return Device{}, err
	}
	s.setDeviceCookie(w, r, device.ID)
	return device, nil
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, user User, temp bool) {
	id := gateid.Identity{
		User: user.Name,
		Role: user.Role,
		Caps: gateid.Caps(user.Role),
		Exp:  s.now().Add(sessionTTL).Unix(),
		Temp: temp,
	}
	if !temp {
		device, err := s.deviceFor(w, r, user.Name)
		if err != nil {
			s.log.Warn("gate device add", "error", err)
		} else {
			id.Dev = device.ID
		}
	}
	s.setSession(w, r, id, !temp)
	s.ensureAppSession(w, r, !temp)
}

func (s *Server) setDeviceCookie(w http.ResponseWriter, r *http.Request, id string) {
	http.SetCookie(w, &http.Cookie{
		Name:     deviceCookie,
		Value:    id,
		Path:     "/",
		MaxAge:   int(deviceTTL.Seconds()),
		HttpOnly: true,
		Secure:   s.secure(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) setSession(w http.ResponseWriter, r *http.Request, id gateid.Identity, persist bool) {
	cookie := &http.Cookie{
		Name:     sessionCookie,
		Value:    gateid.Sign(s.secret, id),
		Path:     "/",
		HttpOnly: true,
		Secure:   s.secure(r),
		SameSite: http.SameSiteLaxMode,
	}
	if persist {
		cookie.MaxAge = int(sessionTTL.Seconds())
	}
	http.SetCookie(w, cookie)
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
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	until, ok := s.blocked[ip]
	if !ok {
		return 0, false
	}
	if !now.Before(until) {
		delete(s.blocked, ip)
		delete(s.failed, ip)
		return 0, false
	}
	return until.Sub(now), true
}

func (s *Server) noteFailure(r *http.Request) {
	ip := clientIP(r)
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failed[ip]++
	if s.failed[ip] < maxFailures {
		return
	}
	if last, ok := s.last[ip]; !ok || now.Sub(last) > blockForget {
		s.blocks[ip] = 0
	}
	wait := blockTime
	for i := 0; i < s.blocks[ip] && wait < blockMax; i++ {
		wait *= 2
	}
	if wait > blockMax {
		wait = blockMax
	}
	s.blocks[ip]++
	s.last[ip] = now
	s.blocked[ip] = now.Add(wait)
	s.failed[ip] = 0
}

func (s *Server) resetFailures(r *http.Request) {
	ip := clientIP(r)
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.failed, ip)
	delete(s.blocked, ip)
	delete(s.blocks, ip)
	delete(s.last, ip)
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
