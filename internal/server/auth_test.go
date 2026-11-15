package server

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"nitgui/internal/auth"
	"nitgui/internal/gateid"
)

func testAuthGate(t *testing.T) *authGate {
	t.Helper()
	hash, err := auth.Hash("secret")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("NIT_GUI_PASSWORD_HASH", hash)
	t.Setenv("NIT_GUI_PASSWORD", "")
	return newAuthGate(nil)
}

func authRequest(method, target, body string) *http.Request {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.RemoteAddr = "203.0.113.10:1234"
	if body != "" {
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	return request
}

func TestAuthLoginAndSession(t *testing.T) {
	gate := testAuthGate(t)
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := gate.wrap(next)

	login := httptest.NewRecorder()
	handler.ServeHTTP(login, authRequest(http.MethodGet, "/auth", ""))
	if login.Code != http.StatusOK {
		t.Fatalf("login page status = %d", login.Code)
	}
	if !strings.Contains(login.Body.String(), "Sign in") {
		t.Fatal("login page has no form")
	}

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, authRequest(http.MethodGet, "/api/health", ""))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("api status = %d", unauthorized.Code)
	}

	wrong := httptest.NewRecorder()
	handler.ServeHTTP(wrong, authRequest(http.MethodPost, "/auth", url.Values{"password": {"wrong"}}.Encode()))
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password status = %d", wrong.Code)
	}

	ok := httptest.NewRecorder()
	handler.ServeHTTP(ok, authRequest(http.MethodPost, "/auth", url.Values{"password": {"secret"}}.Encode()))
	if ok.Code != http.StatusSeeOther {
		t.Fatalf("login status = %d", ok.Code)
	}
	cookies := ok.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("login set no cookie")
	}
	cookie := cookies[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" {
		t.Fatal("cookie is not HttpOnly/Lax with root path")
	}

	page := authRequest(http.MethodGet, "/", "")
	page.AddCookie(cookie)
	authorized := httptest.NewRecorder()
	handler.ServeHTTP(authorized, page)
	if authorized.Code != http.StatusOK {
		t.Fatalf("authorized status = %d", authorized.Code)
	}
}

func TestAuthBypassesPublicDrop(t *testing.T) {
	gate := testAuthGate(t)
	reached := false
	handler := gate.wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}))

	public := httptest.NewRecorder()
	handler.ServeHTTP(public, authRequest(http.MethodGet, "/d/report/", ""))
	if public.Code != http.StatusOK || !reached {
		t.Fatalf("public drop status = %d, reached = %v", public.Code, reached)
	}

	reached = false
	manager := httptest.NewRecorder()
	handler.ServeHTTP(manager, authRequest(http.MethodGet, "/drop/", ""))
	if manager.Code != http.StatusSeeOther || reached {
		t.Fatalf("manager drop status = %d, reached = %v", manager.Code, reached)
	}
	if location := manager.Header().Get("Location"); !strings.HasPrefix(location, "/auth?next=") {
		t.Fatalf("manager redirect = %q", location)
	}

	reached = false
	share := httptest.NewRecorder()
	handler.ServeHTTP(share, authRequest(http.MethodGet, "/share/report/", ""))
	if share.Code != http.StatusOK || !reached {
		t.Fatalf("share drop status = %d, reached = %v", share.Code, reached)
	}

	reached = false
	shareManager := httptest.NewRecorder()
	handler.ServeHTTP(shareManager, authRequest(http.MethodGet, "/share/", ""))
	if shareManager.Code != http.StatusSeeOther || reached {
		t.Fatalf("share manager status = %d, reached = %v", shareManager.Code, reached)
	}
}

func TestShareRouter(t *testing.T) {
	var seen string
	manager := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { seen = "manager " + r.URL.Path })
	public := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { seen = "public " + r.URL.Path })
	router := shareRouter(manager, public)

	cases := map[string]string{
		"/share/":               "manager /",
		"/share/api/upload":     "manager /api/upload",
		"/share/static/drop.js": "manager /static/drop.js",
		"/share/chinese/":       "public /chinese/",
		"/share/chinese/a.png":  "public /chinese/a.png",
	}
	for target, want := range cases {
		seen = ""
		router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, target, nil))
		if seen != want {
			t.Fatalf("%s reached %q, want %q", target, seen, want)
		}
	}
}

func TestAuthAcceptsGateIdentity(t *testing.T) {
	keyPath := filepath.Join(t.TempDir(), "gate.key")
	secret, err := gateid.LoadSecret(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("NIT_GATE_KEY", keyPath)
	gate := testAuthGate(t)
	reached := false
	handler := gate.wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}))

	request := authRequest(http.MethodGet, "/api/sessions", "")
	request.Header.Set(gateid.Header, gateid.Sign(secret, gateid.Identity{
		User: "bongdo",
		Role: gateid.RoleAdmin,
		Caps: gateid.Caps(gateid.RoleAdmin),
		Exp:  time.Now().Add(time.Minute).Unix(),
	}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, request)
	if rec.Code != http.StatusOK || !reached {
		t.Fatalf("gate identity status = %d, reached = %v", rec.Code, reached)
	}

	forged := authRequest(http.MethodGet, "/api/sessions", "")
	forged.Header.Set(gateid.Header, "forged")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, forged)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("forged identity status = %d", rec.Code)
	}
}

func TestAuthLockout(t *testing.T) {
	gate := testAuthGate(t)
	handler := gate.wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))

	for i := 0; i < authMaxFailures; i++ {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, authRequest(http.MethodPost, "/auth", url.Values{"password": {"wrong"}}.Encode()))
	}
	blocked := httptest.NewRecorder()
	handler.ServeHTTP(blocked, authRequest(http.MethodPost, "/auth", url.Values{"password": {"secret"}}.Encode()))
	if blocked.Code != http.StatusTooManyRequests {
		t.Fatalf("lockout status = %d", blocked.Code)
	}
	if blocked.Header().Get("Retry-After") == "" {
		t.Fatal("missing Retry-After header")
	}
	if !strings.Contains(blocked.Body.String(), "Too many attempts") {
		t.Fatal("lockout page has no message")
	}
}

func TestAuthSecureCookieOnPublicHost(t *testing.T) {
	gate := testAuthGate(t)
	gate.publicHost = "frankfurt.tailf358cb.ts.net"
	handler := gate.wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))

	request := authRequest(http.MethodPost, "/auth", url.Values{"password": {"secret"}}.Encode())
	request.Host = "frankfurt.tailf358cb.ts.net"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, request)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("login status = %d", rec.Code)
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 || !cookies[0].Secure {
		t.Fatal("public host did not set a Secure cookie")
	}
}

func TestSessionTokenSharedWithPeroAndTerm(t *testing.T) {
	const token = "v1.2000000000.baa6SCK3SkFG1E7DKlobpA735zGYAznmh2p_U3wOIaQ"
	if !validSessionToken(gateSecret("fixture"), token, time.Unix(1900000000, 0)) {
		t.Fatal("shared session token rejected")
	}
}

func TestSafeNext(t *testing.T) {
	cases := map[string]string{
		"":                     "/nit/",
		"//evil.example":       "/nit/",
		"https://evil.example": "/nit/",
		"/":                    "/nit/",
		"/foo":                 "/nit/foo",
		"/nit/foo":             "/nit/foo",
	}
	for raw, want := range cases {
		if got := safeNext(raw, "/nit"); got != want {
			t.Errorf("safeNext(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestSafeAbsoluteNext(t *testing.T) {
	const publicHost = "frankfurt.tailf358cb.ts.net"
	cases := []struct {
		name string
		raw  string
		host string
		want string
		ok   bool
	}{
		{"public pero", "https://frankfurt.tailf358cb.ts.net/pero/?open=x", "127.0.0.1:7792", "https://frankfurt.tailf358cb.ts.net/pero/?open=x", true},
		{"public term port", "https://frankfurt.tailf358cb.ts.net:8443/term/?dir=%2Ftmp", "frankfurt.tailf358cb.ts.net", "https://frankfurt.tailf358cb.ts.net:8443/term/?dir=%2Ftmp", true},
		{"request host", "https://frankfurt.tailf358cb.ts.net/nit/?x=1", "frankfurt.tailf358cb.ts.net", "https://frankfurt.tailf358cb.ts.net/nit/?x=1", true},
		{"local term", "http://127.0.0.1:7795/term/", "127.0.0.1:7792", "http://127.0.0.1:7795/term/", true},
		{"foreign host", "https://evil.example/pero/", "127.0.0.1:7792", "", false},
		{"suffix host", "https://frankfurt.tailf358cb.ts.net.evil.example/pero/", "127.0.0.1:7792", "", false},
		{"protocol relative", "//frankfurt.tailf358cb.ts.net/pero/", "127.0.0.1:7792", "", false},
		{"javascript", "javascript:alert(1)", "127.0.0.1:7792", "", false},
		{"credentials", "https://user:pass@frankfurt.tailf358cb.ts.net/pero/", "127.0.0.1:7792", "", false},
		{"outside path", "https://frankfurt.tailf358cb.ts.net/api/health", "127.0.0.1:7792", "", false},
		{"prefix trick", "https://frankfurt.tailf358cb.ts.net/nitrogen/", "127.0.0.1:7792", "", false},
		{"dotdot escape", "https://frankfurt.tailf358cb.ts.net/nit/../api/health", "127.0.0.1:7792", "", false},
		{"control char", "https://frankfurt.tailf358cb.ts.net/pero/\n", "127.0.0.1:7792", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := safeAbsoluteNext(tc.raw, tc.host, publicHost)
			if ok != tc.ok || got != tc.want {
				t.Fatalf("safeAbsoluteNext(%q) = %q, %v; want %q, %v", tc.raw, got, ok, tc.want, tc.ok)
			}
		})
	}
}

func TestAuthLoginAbsoluteNext(t *testing.T) {
	gate := testAuthGate(t)
	gate.publicHost = "frankfurt.tailf358cb.ts.net"
	handler := gate.wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))

	target := "https://frankfurt.tailf358cb.ts.net:8443/term/?dir=%2Ftmp"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, authRequest(http.MethodPost, "/auth", url.Values{
		"password": {"secret"},
		"next":     {target},
	}.Encode()))
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("login status = %d", rec.Code)
	}
	if location := rec.Header().Get("Location"); location != target {
		t.Fatalf("location = %q, want %q", location, target)
	}
	if len(rec.Result().Cookies()) == 0 {
		t.Fatal("login set no cookie")
	}
}

func TestAllowedOriginPublicHost(t *testing.T) {
	s := &Server{publicHost: "frankfurt.tailf358cb.ts.net"}
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7791/api/prompt", nil)
	request.Host = "127.0.0.1:7791"
	request.Header.Set("Origin", "https://frankfurt.tailf358cb.ts.net")
	if !s.allowedOrigin(request) {
		t.Fatal("public origin rejected behind a rewritten Host")
	}
	request.Header.Set("Origin", "https://evil.example")
	if s.allowedOrigin(request) {
		t.Fatal("foreign origin accepted")
	}
}

func TestAllowedOriginNull(t *testing.T) {
	gate := testAuthGate(t)
	gate.base = "/nit"
	s := &Server{basePath: "/nit", auth: gate}
	login := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7791/auth", nil)
	login.Header.Set("Origin", "null")
	if !s.allowedOrigin(login) {
		t.Fatal("null origin rejected on the login form")
	}
	api := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7791/api/prompt", nil)
	api.Header.Set("Origin", "null")
	if s.allowedOrigin(api) {
		t.Fatal("null origin accepted without a session")
	}
	api.AddCookie(&http.Cookie{Name: authCookieName, Value: newSessionToken(gate.secret, gate.now())})
	if !s.allowedOrigin(api) {
		t.Fatal("null origin rejected with a session")
	}
}

func TestAuthSessionExpiresAfterSevenDays(t *testing.T) {
	gate := testAuthGate(t)
	now := time.Date(2026, 11, 9, 12, 0, 0, 0, time.UTC)
	gate.now = func() time.Time { return now }
	token := newSessionToken(gate.secret, now)
	if !validSessionToken(gate.secret, token, now.Add(6*24*time.Hour)) {
		t.Fatal("session expired early")
	}
	if validSessionToken(gate.secret, token, now.Add(7*24*time.Hour)) {
		t.Fatal("session survived its seven day ttl")
	}
	if validSessionToken(gateSecret("other"), token, now) {
		t.Fatal("token accepted with a different password")
	}
}

func TestAuthBasePath(t *testing.T) {
	gate := testAuthGate(t)
	gate.base = "/nit"
	handler := gate.wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	root := httptest.NewRecorder()
	handler.ServeHTTP(root, authRequest(http.MethodGet, "/nit/", ""))
	if root.Code != http.StatusSeeOther {
		t.Fatalf("root status = %d", root.Code)
	}
	if location := root.Header().Get("Location"); !strings.HasPrefix(location, "/nit/auth?next=") {
		t.Fatalf("root redirect = %q", location)
	}

	login := httptest.NewRecorder()
	handler.ServeHTTP(login, authRequest(http.MethodGet, "/nit/auth", ""))
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d", login.Code)
	}
	if !strings.Contains(login.Body.String(), `action="/nit/auth"`) {
		t.Fatal("login form does not keep the base path")
	}
}
