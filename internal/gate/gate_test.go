package gate

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
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
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if seen != nil {
			*seen = r.Header.Clone()
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, r.URL.Path)
	}))
	t.Cleanup(upstream.Close)
	store := testStore(t)
	server := httptest.NewServer(New(testRoutes(t, upstream.URL), store, []byte(testKey), nil).Handler())
	t.Cleanup(server.Close)
	return server, store
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
