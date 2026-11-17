package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"nitgui/internal/gateid"
)

func testAuthGate(t *testing.T) (*authGate, []byte) {
	t.Helper()
	keyPath := filepath.Join(t.TempDir(), "gate.key")
	secret, err := gateid.LoadSecret(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("NIT_GATE_KEY", keyPath)
	t.Setenv("NIT_GUI_PUBLIC_HOST", "frankfurt.tailf358cb.ts.net")
	t.Setenv("NIT_GUI_BASE_PATH", "")
	return newAuthGate(nil), secret
}

func signedIdentity(secret []byte, expires time.Time) string {
	return gateid.Sign(secret, gateid.Identity{
		User: "bongdo",
		Role: gateid.RoleAdmin,
		Caps: gateid.Caps(gateid.RoleAdmin),
		Exp:  expires.Unix(),
	})
}

func authRequest(target string) *http.Request {
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.RemoteAddr = "203.0.113.10:1234"
	return request
}

func TestPublicDropPathIsAnonymous(t *testing.T) {
	gate, _ := testAuthGate(t)
	gate.base = "/nit"
	var reached string
	handler := gate.wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))

	for _, target := range []string{"/d/report/", "/share/report/", "/nit/d/report/", "/nit/share/report/"} {
		reached = ""
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, authRequest(target))
		if rec.Code != http.StatusOK || reached == "" {
			t.Fatalf("%s status = %d, reached = %q", target, rec.Code, reached)
		}
	}

	for _, target := range []string{"/", "/drop/", "/share/", "/api/health", "/nit/", "/nit/api/health"} {
		reached = ""
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, authRequest(target))
		if reached != "" {
			t.Fatalf("%s reached the app anonymously", target)
		}
		if strings.HasPrefix(target, "/api") || strings.Contains(target, "/api/") {
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("%s status = %d, want 401", target, rec.Code)
			}
			continue
		}
		if rec.Code != http.StatusSeeOther || !strings.HasPrefix(rec.Header().Get("Location"), "/login?next=") {
			t.Fatalf("%s status = %d, location = %q", target, rec.Code, rec.Header().Get("Location"))
		}
	}
}

func TestPrivatePathNeedsGateCookie(t *testing.T) {
	gate, secret := testAuthGate(t)
	var reached bool
	handler := gate.wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}))

	request := authRequest("/api/sessions")
	request.AddCookie(&http.Cookie{Name: authCookieName, Value: signedIdentity(secret, time.Now().Add(time.Hour))})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, request)
	if rec.Code != http.StatusOK || !reached {
		t.Fatalf("cookie session status = %d, reached = %v", rec.Code, reached)
	}

	reached = false
	header := authRequest("/api/sessions")
	header.Header.Set(gateid.Header, signedIdentity(secret, time.Now().Add(time.Hour)))
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, header)
	if rec.Code != http.StatusOK || !reached {
		t.Fatalf("gate header status = %d, reached = %v", rec.Code, reached)
	}
}

func TestAuthRejectsForgedOrStaleCookie(t *testing.T) {
	gate, secret := testAuthGate(t)
	handler := gate.wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	otherKey := filepath.Join(t.TempDir(), "other.key")
	other, err := gateid.LoadSecret(otherKey)
	if err != nil {
		t.Fatal(err)
	}

	cases := map[string]string{
		"garbage":        "forged",
		"not signed":     "v1.2000000000.baa6SCK3SkFG1E7DKlobpA735zGYAznmh2p_U3wOIaQ",
		"stale":          signedIdentity(secret, time.Now().Add(-time.Minute)),
		"foreign secret": signedIdentity(other, time.Now().Add(time.Hour)),
	}
	for name, value := range cases {
		t.Run(name, func(t *testing.T) {
			request := authRequest("/api/sessions")
			request.AddCookie(&http.Cookie{Name: authCookieName, Value: value})
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, request)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d", rec.Code)
			}
			page := authRequest("/")
			page.AddCookie(&http.Cookie{Name: authCookieName, Value: value})
			rec = httptest.NewRecorder()
			handler.ServeHTTP(rec, page)
			if rec.Code != http.StatusSeeOther {
				t.Fatalf("page status = %d", rec.Code)
			}
		})
	}
}

func TestAuthDisabledWithoutPublicHost(t *testing.T) {
	keyPath := filepath.Join(t.TempDir(), "gate.key")
	if _, err := gateid.LoadSecret(keyPath); err != nil {
		t.Fatal(err)
	}
	t.Setenv("NIT_GATE_KEY", keyPath)
	t.Setenv("NIT_GUI_PUBLIC_HOST", "")
	gate := newAuthGate(nil)
	if gate.enabled {
		t.Fatal("local instance without a public host requires a gate session")
	}
	reached := false
	gate.wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
	})).ServeHTTP(httptest.NewRecorder(), authRequest("/api/sessions"))
	if !reached {
		t.Fatal("local instance rejected a request")
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
	gate, secret := testAuthGate(t)
	s := &Server{basePath: "/nit", auth: gate}
	api := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7791/api/prompt", nil)
	api.Header.Set("Origin", "null")
	if s.allowedOrigin(api) {
		t.Fatal("null origin accepted without a gate session")
	}
	api.AddCookie(&http.Cookie{Name: authCookieName, Value: signedIdentity(secret, time.Now().Add(time.Hour))})
	if !s.allowedOrigin(api) {
		t.Fatal("null origin rejected with a gate session")
	}
}

func TestAllowedHost(t *testing.T) {
	s := &Server{
		publicHost:   "frankfurt.tailf358cb.ts.net",
		allowedHosts: map[string]struct{}{"frankfurt.tailf358cb.ts.net": {}, "bongdo.space": {}},
	}
	cases := map[string]bool{
		"localhost:7788":                   true,
		"127.0.0.1:7788":                   true,
		"[::1]:7788":                       true,
		"frankfurt.tailf358cb.ts.net":      true,
		"bongdo.space:443":                 true,
		"evil.example":                     false,
		"frankfurt.tailf358cb.ts.net.evil": false,
		"":                                 false,
	}
	for host, want := range cases {
		if got := s.allowedHost(host); got != want {
			t.Errorf("allowedHost(%q) = %v, want %v", host, got, want)
		}
	}
}
