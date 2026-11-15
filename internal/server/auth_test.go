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
