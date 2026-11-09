package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"html/template"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"nitgui/internal/auth"
)

const (
	authCookieName      = "nit_gate"
	authSessionTTL      = 7 * 24 * time.Hour
	authMaxFailures     = 5
	authBlockFor        = 15 * time.Minute
	authGlobalMax       = 50
	authGlobalBlockFor  = 5 * time.Minute
	authAttemptLifetime = 24 * time.Hour
)

type authAttempt struct {
	failures     int
	blockedUntil time.Time
	last         time.Time
}

type authGate struct {
	enabled            bool
	hash               string
	secret             []byte
	base               string
	publicHost         string
	log                *slog.Logger
	mu                 sync.Mutex
	attempts           map[string]*authAttempt
	globalFailures     int
	globalReset        time.Time
	globalBlockedUntil time.Time
	now                func() time.Time
}

type loginPageData struct {
	Action  string
	Next    string
	Error   string
	Blocked bool
}

var loginTemplate = template.Must(template.New("login").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<link rel="icon" href="data:,">
<title>nit-gui — sign in</title>
<style>
:root { color-scheme: dark; --bg:#0c0c0d; --panel:#151517; --line:#2a2a2e; --text:#f1f0ee; --muted:#a3a09b; --copper:#c4794f; --danger:#e07a6a; }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; background:radial-gradient(circle at 50% 20%, #1d1713 0, var(--bg) 45%); color:var(--text); font:15px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
main { width:min(92vw, 360px); padding:28px; background:var(--panel); border:1px solid var(--line); border-radius:14px; box-shadow:0 24px 80px rgba(0,0,0,.45); }
.brand { display:flex; align-items:center; gap:9px; margin-bottom:22px; color:var(--muted); font-size:13px; letter-spacing:.08em; text-transform:uppercase; }
.brand b { display:inline-grid; place-items:center; width:24px; height:24px; border-radius:7px; background:var(--copper); color:#1a100b; font-size:14px; letter-spacing:0; }
h1 { margin:0 0 6px; font-size:22px; font-weight:600; letter-spacing:-.02em; }
p { margin:0 0 20px; color:var(--muted); font-size:14px; }
label { display:block; margin-bottom:8px; color:var(--muted); font-size:12px; letter-spacing:.04em; text-transform:uppercase; }
input { width:100%; padding:11px 12px; border:1px solid var(--line); border-radius:9px; background:#0f0f10; color:var(--text); font:inherit; outline:none; }
input:focus { border-color:var(--copper); box-shadow:0 0 0 3px rgba(196,121,79,.15); }
button { width:100%; margin-top:14px; padding:11px 12px; border:0; border-radius:9px; background:var(--copper); color:#1a100b; font:inherit; font-weight:650; cursor:pointer; }
button:hover { filter:brightness(1.08); }
button:disabled { cursor:not-allowed; opacity:.55; }
.error { margin:0 0 16px; padding:10px 12px; border:1px solid rgba(224,122,106,.35); border-radius:9px; background:rgba(224,122,106,.08); color:var(--danger); font-size:13px; }
.foot { margin:18px 0 0; color:#6f6c68; font-size:12px; text-align:center; }
</style>
</head>
<body>
<main>
<div class="brand"><b>n</b> nit-gui</div>
<h1>Sign in</h1>
<p>This instance is private. Enter the server password to continue.</p>
{{if .Error}}<div class="error" role="alert">{{.Error}}</div>{{end}}
<form method="post" action="{{.Action}}">
<input type="hidden" name="next" value="{{.Next}}">
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus {{if .Blocked}}disabled{{end}}>
<button type="submit" {{if .Blocked}}disabled{{end}}>Continue</button>
</form>
<p class="foot">One password. No accounts.</p>
</main>
</body>
</html>`))

func newAuthGate(log *slog.Logger) *authGate {
	if log == nil {
		log = slog.Default()
	}
	hash := strings.TrimSpace(os.Getenv("NIT_GATE_PASSWORD_HASH"))
	if hash == "" {
		hash = strings.TrimSpace(os.Getenv("NIT_GUI_PASSWORD_HASH"))
	}
	if hash == "" {
		password := os.Getenv("NIT_GATE_PASSWORD")
		if password == "" {
			password = os.Getenv("NIT_GUI_PASSWORD")
		}
		if password != "" {
			var err error
			hash, err = auth.Hash(password)
			if err != nil {
				log.Error("auth password hash failed", "error", err)
			}
		}
	}
	return &authGate{
		enabled:    hash != "",
		hash:       hash,
		secret:     gateSecret(hash),
		base:       strings.TrimRight(os.Getenv("NIT_GUI_BASE_PATH"), "/"),
		publicHost: strings.TrimSuffix(strings.ToLower(strings.TrimSpace(os.Getenv("NIT_GUI_PUBLIC_HOST"))), "."),
		log:        log,
		attempts:   map[string]*authAttempt{},
		now:        time.Now,
	}
}

func (a *authGate) wrap(next http.Handler) http.Handler {
	if !a.enabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath := a.trimBase(r.URL.Path)
		switch requestPath {
		case "/auth", "/auth/":
			a.handleLogin(w, r)
			return
		case "/auth/logout":
			a.handleLogout(w, r)
			return
		}
		clean := path.Clean(requestPath)
		if requestPath == "/d" || (strings.HasPrefix(requestPath, "/d/") && (clean == "/d" || strings.HasPrefix(clean, "/d/"))) {
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
		nextPath := a.externalPath(r.URL.RequestURI())
		http.Redirect(w, r, a.authPath()+"?next="+url.QueryEscape(nextPath), http.StatusSeeOther)
	})
}

func (a *authGate) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	next := a.nextTarget(r, r.URL.Query().Get("next"))
	if r.Method == http.MethodGet {
		if a.authenticated(r) {
			http.Redirect(w, r, next, http.StatusSeeOther)
			return
		}
		a.renderLogin(w, r, http.StatusOK, next, "", false)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := r.ParseForm(); err != nil {
		a.renderLogin(w, r, http.StatusBadRequest, next, "Invalid request.", false)
		return
	}
	next = a.nextTarget(r, r.FormValue("next"))
	ip := clientIP(r)
	allowed, retry := a.allowAttempt(ip)
	if !allowed {
		setRetryAfter(w, retry)
		a.renderLogin(w, r, http.StatusTooManyRequests, next, blockMessage(retry), true)
		return
	}
	if auth.Verify(a.hash, r.FormValue("password")) {
		a.clearFailures(ip)
		a.startSession(w, r)
		http.Redirect(w, r, next, http.StatusSeeOther)
		return
	}
	a.recordFailure(ip)
	allowed, retry = a.allowAttempt(ip)
	if !allowed {
		a.log.Warn("auth lockout", "ip", ip, "retry_after", retry.Round(time.Second).String())
		setRetryAfter(w, retry)
		a.renderLogin(w, r, http.StatusTooManyRequests, next, blockMessage(retry), true)
		return
	}
	a.log.Warn("auth failed", "ip", ip)
	a.renderLogin(w, r, http.StatusUnauthorized, next, "Wrong password.", false)
}

func (a *authGate) handleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	a.setSessionCookie(w, r, "", -1)
	http.Redirect(w, r, a.authPath(), http.StatusSeeOther)
}

func (a *authGate) renderLogin(w http.ResponseWriter, r *http.Request, status int, next, message string, blocked bool) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
	w.WriteHeader(status)
	_ = loginTemplate.Execute(w, loginPageData{
		Action:  a.authPath(),
		Next:    next,
		Error:   message,
		Blocked: blocked,
	})
}

func (a *authGate) authenticated(r *http.Request) bool {
	cookie, err := r.Cookie(authCookieName)
	if err != nil || cookie.Value == "" {
		return false
	}
	return validSessionToken(a.secret, cookie.Value, a.now())
}

func (a *authGate) startSession(w http.ResponseWriter, r *http.Request) {
	a.setSessionCookie(w, r, newSessionToken(a.secret, a.now()), int(authSessionTTL.Seconds()))
}

func (a *authGate) setSessionCookie(w http.ResponseWriter, r *http.Request, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   a.secure(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (a *authGate) allowAttempt(ip string) (bool, time.Duration) {
	now := a.now()
	a.mu.Lock()
	defer a.mu.Unlock()
	a.prune(now)
	if now.Before(a.globalBlockedUntil) {
		return false, a.globalBlockedUntil.Sub(now)
	}
	if attempt := a.attempts[ip]; attempt != nil && now.Before(attempt.blockedUntil) {
		return false, attempt.blockedUntil.Sub(now)
	}
	return true, 0
}

func (a *authGate) recordFailure(ip string) {
	now := a.now()
	a.mu.Lock()
	defer a.mu.Unlock()
	attempt := a.attempts[ip]
	if attempt == nil {
		attempt = &authAttempt{}
		a.attempts[ip] = attempt
	}
	attempt.failures++
	attempt.last = now
	if attempt.failures >= authMaxFailures {
		attempt.failures = 0
		attempt.blockedUntil = now.Add(authBlockFor)
	}
	if now.After(a.globalReset) {
		a.globalFailures = 0
		a.globalReset = now.Add(15 * time.Minute)
	}
	a.globalFailures++
	if a.globalFailures >= authGlobalMax {
		a.globalFailures = 0
		a.globalReset = now.Add(15 * time.Minute)
		a.globalBlockedUntil = now.Add(authGlobalBlockFor)
	}
}

func (a *authGate) clearFailures(ip string) {
	a.mu.Lock()
	delete(a.attempts, ip)
	a.mu.Unlock()
}

func (a *authGate) prune(now time.Time) {
	for ip, attempt := range a.attempts {
		if now.Sub(attempt.last) > authAttemptLifetime {
			delete(a.attempts, ip)
		}
	}
	if !a.globalReset.IsZero() && now.After(a.globalReset) && now.After(a.globalBlockedUntil) {
		a.globalFailures = 0
	}
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
	if a.base == "" || path == a.base || strings.HasPrefix(path, a.base+"/") {
		return path
	}
	return a.base + path
}

func (a *authGate) authPath() string {
	return a.base + "/auth"
}

func gateSecret(credential string) []byte {
	sum := sha256.Sum256([]byte("nit-gate-session-v1\x00" + credential))
	return sum[:]
}

func newSessionToken(secret []byte, now time.Time) string {
	payload := "v1." + strconv.FormatInt(now.Add(authSessionTTL).Unix(), 10)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func validSessionToken(secret []byte, value string, now time.Time) bool {
	parts := strings.Split(value, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		return false
	}
	expires, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || now.Unix() >= expires {
		return false
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	return hmac.Equal(signature, mac.Sum(nil))
}

func (a *authGate) nextTarget(r *http.Request, raw string) string {
	if target, ok := safeAbsoluteNext(raw, forwardedHost(r), a.publicHost); ok {
		return target
	}
	return safeNext(raw, a.base)
}

func safeAbsoluteNext(raw, requestHost, publicHost string) (string, bool) {
	for _, char := range raw {
		if char < 0x20 || char == 0x7f || char == '\\' {
			return "", false
		}
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.Opaque != "" {
		return "", false
	}
	if !strings.EqualFold(u.Scheme, "http") && !strings.EqualFold(u.Scheme, "https") {
		return "", false
	}
	host := strings.ToLower(hostOnly(u.Host))
	want := strings.ToLower(hostOnly(requestHost))
	if host != want && (publicHost == "" || host != publicHost) {
		return "", false
	}
	if !gateReturnPath(path.Clean(u.Path)) {
		return "", false
	}
	return u.String(), true
}

func gateReturnPath(path string) bool {
	for _, prefix := range []string{"/nit", "/pero", "/term"} {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
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
	if base != "" && raw != base && !strings.HasPrefix(raw, base+"/") {
		if raw == "/" {
			return base + "/"
		}
		return base + raw
	}
	return raw
}

func setRetryAfter(w http.ResponseWriter, retry time.Duration) {
	seconds := int((retry + time.Second - 1) / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
}

func blockMessage(retry time.Duration) string {
	minutes := int((retry + time.Minute - 1) / time.Minute)
	if minutes < 1 {
		minutes = 1
	}
	return fmt.Sprintf("Too many attempts. Try again in %d min.", minutes)
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
