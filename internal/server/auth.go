package server

import (
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	"nitgui/internal/drop"
	"nitgui/internal/gateid"
)

const authCookieName = "nit_gate"

type authGate struct {
	enabled    bool
	base       string
	publicHost string
	secret     []byte
}

func newAuthGate(*slog.Logger) *authGate {
	secret, err := gateid.ReadSecret(gateid.DefaultSecretPath())
	if err != nil {
		secret = nil
	}
	publicHost := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(os.Getenv("NIT_GUI_PUBLIC_HOST"))), ".")
	return &authGate{
		enabled:    len(secret) > 0 && publicHost != "",
		base:       strings.TrimRight(os.Getenv("NIT_GUI_BASE_PATH"), "/"),
		publicHost: publicHost,
		secret:     secret,
	}
}

func (a *authGate) wrap(next http.Handler) http.Handler {
	if !a.enabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath := a.trimBase(r.URL.Path)
		if publicDropPath(requestPath) {
			next.ServeHTTP(w, r)
			return
		}
		if a.authenticated(r) {
			next.ServeHTTP(w, r)
			return
		}
		if requestPath == "/api" || strings.HasPrefix(requestPath, "/api/") {
			writeError(w, http.StatusUnauthorized, "authentication required")
			return
		}
		http.Redirect(w, r, "/login?next="+url.QueryEscape(a.externalPath(r.URL.RequestURI())), http.StatusSeeOther)
	})
}

func outsideBase(path string) bool {
	return path == shareBase || strings.HasPrefix(path, shareBase+"/")
}

func publicDropPath(requestPath string) bool {
	clean := path.Clean(requestPath)
	if requestPath == "/d" ||
		(strings.HasPrefix(requestPath, "/d/") && (clean == "/d" || strings.HasPrefix(clean, "/d/"))) {
		return true
	}
	rest, ok := strings.CutPrefix(requestPath, shareBase+"/")
	if !ok {
		return false
	}
	cleanRest, ok := strings.CutPrefix(clean, shareBase+"/")
	return ok && drop.PublicPath(rest) && drop.PublicPath(cleanRest)
}

func (a *authGate) authenticated(r *http.Request) bool {
	if len(a.secret) == 0 {
		return false
	}
	if id, ok := gateid.From(r, a.secret); ok && !id.Anonymous() {
		return true
	}
	cookie, err := r.Cookie(authCookieName)
	if err != nil || cookie.Value == "" {
		return false
	}
	id, err := gateid.Verify(a.secret, cookie.Value, time.Now())
	return err == nil && !id.Anonymous()
}

func (a *authGate) trimBase(path string) string {
	if a.base == "" {
		return path
	}
	if path == a.base {
		return "/"
	}
	if strings.HasPrefix(path, a.base+"/") {
		return strings.TrimPrefix(path, a.base)
	}
	return path
}

func (a *authGate) externalPath(path string) string {
	if path == "" {
		path = "/"
	}
	if a.base == "" || path == a.base || strings.HasPrefix(path, a.base+"/") || outsideBase(path) {
		return path
	}
	return a.base + path
}

func safeNext(raw, base string) string {
	if raw == "" || raw[0] != '/' || strings.HasPrefix(raw, "//") {
		return base + "/"
	}
	for _, r := range raw {
		if r < 0x20 || r == 0x7f || r == '\\' {
			return base + "/"
		}
	}
	if base != "" && raw != base && !strings.HasPrefix(raw, base+"/") && !outsideBase(raw) {
		if raw == "/" {
			return base + "/"
		}
		return base + raw
	}
	return raw
}

func (a *authGate) secure(r *http.Request) bool {
	if isHTTPS(r) {
		return true
	}
	if a.publicHost == "" {
		return false
	}
	if strings.EqualFold(hostOnly(forwardedHost(r)), a.publicHost) {
		return true
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		if u, err := url.Parse(origin); err == nil {
			return strings.EqualFold(hostOnly(u.Host), a.publicHost)
		}
	}
	return false
}

func isHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

func hostOnly(hostport string) string {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	return strings.TrimSuffix(strings.Trim(host, "[]"), ".")
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if host == "127.0.0.1" || host == "::1" {
		forwarded := r.Header.Get("X-Forwarded-For")
		if forwarded != "" {
			for _, part := range strings.Split(forwarded, ",") {
				if ip := strings.TrimSpace(part); ip != "" {
					return ip
				}
			}
		}
	}
	return host
}
