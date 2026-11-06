package server

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"nitgui/internal/auth"
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
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatal("cookie is not HttpOnly/Strict")
	}

	page := authRequest(http.MethodGet, "/", "")
	page.AddCookie(cookie)
	authorized := httptest.NewRecorder()
	handler.ServeHTTP(authorized, page)
	if authorized.Code != http.StatusOK {
		t.Fatalf("authorized status = %d", authorized.Code)
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
