package gate

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"nitgui/internal/auth"
	"nitgui/internal/gateid"
)

const testKey = "0123456789abcdef0123456789abcdef"

func testRoutes(t *testing.T, upstream string) *Routes {
	t.Helper()
	path := filepath.Join(t.TempDir(), "routes.json")
	body, err := json.Marshal(routesFile{Routes: []Route{
		{Prefix: "/nit", Cap: gateid.AdminHost, Upstream: upstream},
		{Prefix: "/share", Optional: true, Upstream: upstream},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	routes, err := OpenRoutes(path)
	if err != nil {
		t.Fatal(err)
	}
	return routes
}

func testStore(t *testing.T) *Store {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "users.json"))
	if err != nil {
		t.Fatal(err)
	}
	hash, err := auth.Hash("secret-pass")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Seed("bongdo", gateid.RoleAdmin, hash); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Request("friend"); err != nil {
		t.Fatal(err)
	}
	token, err := store.Approve("friend")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetPassword(token, "member-pass"); err != nil {
		t.Fatal(err)
	}
	return store
}

func testServer(t *testing.T, seen *http.Header) (*httptest.Server, *Store) {
	t.Helper()
	server, store, _ := testServerDevices(t, seen)
	return server, store
}

func testServerDevices(t *testing.T, seen *http.Header) (*httptest.Server, *Store, *Devices) {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if seen != nil {
			*seen = r.Header.Clone()
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, r.URL.Path)
	}))
	t.Cleanup(upstream.Close)
	store := testStore(t)
	agents, err := OpenAgents(filepath.Join(t.TempDir(), "agents.json"))
	if err != nil {
		t.Fatal(err)
	}
	devices, err := OpenDevices(filepath.Join(t.TempDir(), "devices.json"))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(New(testRoutes(t, upstream.URL), store, agents, []byte(testKey), nil, devices).Handler())
	t.Cleanup(server.Close)
	return server, store, devices
}

func noRedirect(t *testing.T) *http.Client {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &http.Client{
		Jar: jar,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func TestAnonymousGetsPublicOnly(t *testing.T) {
	server, _ := testServer(t, nil)
	client := noRedirect(t)

	resp, err := client.Get(server.URL + "/share/thing/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("public route = %d", resp.StatusCode)
	}

	resp, err = client.Get(server.URL + "/nit/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("gated route = %d", resp.StatusCode)
	}
	if location := resp.Header.Get("Location"); !strings.HasPrefix(location, "/login?next=") {
		t.Fatalf("redirect = %q", location)
	}
}

func TestForgedHeaderIsStripped(t *testing.T) {
	seen := http.Header{}
	server, _ := testServer(t, &seen)
	client := noRedirect(t)

	request, err := http.NewRequest(http.MethodGet, server.URL+"/share/thing/", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set(gateid.Header, "forged")
	resp, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if seen.Get(gateid.Header) != "" {
		t.Fatalf("client identity reached upstream: %q", seen.Get(gateid.Header))
	}
}

func login(t *testing.T, client *http.Client, base, name, password string) *http.Response {
	t.Helper()
	form := strings.NewReader("name=" + name + "&password=" + password + "&next=/")
	resp, err := client.Post(base+"/login", "application/x-www-form-urlencoded", form)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp
}

func TestLoginForwardsIdentity(t *testing.T) {
	seen := http.Header{}
	server, _ := testServer(t, &seen)
	client := noRedirect(t)

	resp := login(t, client, server.URL, "bongdo", "secret-pass")
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("login = %d", resp.StatusCode)
	}
	resp, err := client.Get(server.URL + "/nit/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("gated route after login = %d", resp.StatusCode)
	}
	id, err := gateid.Verify([]byte(testKey), seen.Get(gateid.Header), time.Now())
	if err != nil {
		t.Fatalf("upstream identity = %q: %v", seen.Get(gateid.Header), err)
	}
	if id.User != "bongdo" || !id.Has(gateid.AdminHost) {
		t.Fatalf("upstream identity = %+v", id)
	}
	if seen.Get("X-Forwarded-Proto") != "http" {
		t.Fatalf("forwarded proto = %q", seen.Get("X-Forwarded-Proto"))
	}
}

func TestMemberCannotReachAdminRoute(t *testing.T) {
	server, _ := testServer(t, nil)
	client := noRedirect(t)
	if resp := login(t, client, server.URL, "friend", "member-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("member login = %d", resp.StatusCode)
	}
	resp, err := client.Get(server.URL + "/nit/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("member on admin route = %d", resp.StatusCode)
	}
	resp, err = client.Get(server.URL + "/share/thing/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("member on public route = %d", resp.StatusCode)
	}
}

func TestInviteFlow(t *testing.T) {
	server, store := testServer(t, nil)
	client := noRedirect(t)

	resp, err := client.Post(server.URL+"/signup", "application/x-www-form-urlencoded", strings.NewReader("name=newbie"))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("signup = %d", resp.StatusCode)
	}
	user, ok := store.Get("newbie")
	if !ok || user.Status != StatusPending {
		t.Fatalf("pending user = %+v", user)
	}
	if resp := login(t, client, server.URL, "newbie", "whatever-pass"); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("pending login = %d", resp.StatusCode)
	}

	token, err := store.Approve("newbie")
	if err != nil {
		t.Fatal(err)
	}
	resp, err = client.Post(server.URL+"/i/"+token, "application/x-www-form-urlencoded",
		strings.NewReader("password=newbie-pass&confirm=newbie-pass"))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("set password = %d", resp.StatusCode)
	}
	if resp := login(t, client, server.URL, "newbie", "newbie-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("member login = %d", resp.StatusCode)
	}
}

func TestUnknownUserCannotLogin(t *testing.T) {
	server, _ := testServer(t, nil)
	client := noRedirect(t)
	if resp := login(t, client, server.URL, "bongdo", "wrong-pass"); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong password = %d", resp.StatusCode)
	}
}

func TestRoutesValidate(t *testing.T) {
	for _, bad := range [][]Route{
		{{Prefix: "", Cap: gateid.AdminHost, Upstream: "http://127.0.0.1:1"}},
		{{Prefix: "/x", Cap: "nope", Upstream: "http://127.0.0.1:1"}},
		{{Prefix: "/x", Cap: "", Upstream: ""}},
		{{Prefix: "/x", Cap: gateid.ReadPublic, Optional: true, Upstream: "http://127.0.0.1:1"}},
	} {
		if err := validate(bad); err == nil {
			t.Fatalf("route %+v accepted", bad)
		}
	}
	good := []Route{{Prefix: "/x", Cap: gateid.ReadPublic, Upstream: "http://127.0.0.1:1"}}
	if err := validate(good); err != nil {
		t.Fatalf("valid route rejected: %v", err)
	}
}

func TestMatchPrefersLongest(t *testing.T) {
	routes := &Routes{list: []Route{
		{Prefix: "/share", Optional: true, Upstream: "a"},
		{Prefix: "/share/api", Cap: gateid.WriteOwn, Upstream: "b"},
	}}
	route, ok := routes.Match("/share/api/upload")
	if !ok || route.Upstream != "b" {
		t.Fatalf("match = %+v ok=%v", route, ok)
	}
	if _, ok := routes.Match("/nope"); ok {
		t.Fatal("unrouted path matched")
	}
}

func TestAPIRequestGetsUnauthorized(t *testing.T) {
	server, _ := testServer(t, nil)
	request, err := http.NewRequest(http.MethodGet, server.URL+"/nit/api/sessions", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Accept", "application/json")
	response, err := noRedirect(t).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.StatusCode)
	}
	if got := response.Header.Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Fatalf("content type = %q", got)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "authentication required") {
		t.Fatalf("body = %s", body)
	}
}

func TestBrowserRequestStillRedirects(t *testing.T) {
	server, _ := testServer(t, nil)
	response, err := noRedirect(t).Get(server.URL + "/nit/")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", response.StatusCode)
	}
	if location := response.Header.Get("Location"); !strings.HasPrefix(location, "/login") {
		t.Fatalf("location = %q", location)
	}
}

func TestLoopbackServiceIdentity(t *testing.T) {
	seen := http.Header{}
	server, _ := testServer(t, &seen)
	id := gateid.Identity{
		User: "nit-gui",
		Role: gateid.RoleAdmin,
		Caps: gateid.Caps(gateid.RoleAdmin),
		Exp:  time.Now().Add(time.Minute).Unix(),
	}
	token := gateid.Sign([]byte(testKey), id)

	request, err := http.NewRequest(http.MethodGet, server.URL+"/nit/api/info", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set(gateid.Header, token)
	response, err := noRedirect(t).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	forwarded := seen.Get(gateid.Header)
	if forwarded == "" {
		t.Fatal("upstream saw no identity")
	}
	got, err := gateid.Verify([]byte(testKey), forwarded, time.Now())
	if err != nil {
		t.Fatalf("forwarded identity: %v", err)
	}
	if got.User != "nit-gui" {
		t.Fatalf("forwarded user = %q", got.User)
	}
}

func TestServiceIdentityIgnoredOffLoopback(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	handler := New(testRoutes(t, upstream.URL), testStore(t), testAgents(t), []byte(testKey), nil).Handler()

	id := gateid.Identity{
		User: "nit-gui",
		Role: gateid.RoleAdmin,
		Caps: gateid.Caps(gateid.RoleAdmin),
		Exp:  time.Now().Add(time.Minute).Unix(),
	}
	request := httptest.NewRequest(http.MethodGet, "http://gate.local/nit/api/info", nil)
	request.RemoteAddr = "203.0.113.5:4000"
	request.Header.Set(gateid.Header, gateid.Sign([]byte(testKey), id))
	request.Header.Set("Accept", "application/json")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
}

func TestCorrectPasswordBreaksTheBlock(t *testing.T) {
	server, _ := testServer(t, nil)
	client := noRedirect(t)

	attempt := func(name, password string) int {
		form := url.Values{"name": {name}, "password": {password}}
		response, err := client.PostForm(server.URL+"/login", form)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		_, _ = io.Copy(io.Discard, response.Body)
		return response.StatusCode
	}

	for i := 0; i < 4; i++ {
		if code := attempt("bongdo", "wrong"); code != http.StatusUnauthorized {
			t.Fatalf("attempt %d = %d, want 401", i+1, code)
		}
	}
	if code := attempt("bongdo", "wrong"); code != http.StatusTooManyRequests {
		t.Fatalf("fifth wrong attempt = %d, want 429", code)
	}
	if code := attempt("bongdo", "secret-pass"); code != http.StatusSeeOther {
		t.Fatalf("correct password during a block = %d, want 303", code)
	}
	response, err := client.Get(server.URL + "/nit/")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("after login status = %d, want 200", response.StatusCode)
	}
}

func TestWrongAttemptDuringBlockStaysBlocked(t *testing.T) {
	client := noRedirect(t)
	attempt := func(password string) int {
		form := url.Values{"name": {"bongdo"}, "password": {password}}
		response, err := client.PostForm(server.URL+"/login", form)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		_, _ = io.Copy(io.Discard, response.Body)
		return response.StatusCode
	}
	for i := 0; i < 5; i++ {
		attempt("wrong")
	}
	for i := 0; i < 3; i++ {
		if code := attempt("wrong-again"); code != http.StatusTooManyRequests {
			t.Fatalf("wrong attempt %d during block = %d, want 429", i+1, code)
		}
	}
}
