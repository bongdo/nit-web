package gate

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
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
	devices, err := OpenDevices(filepath.Join(t.TempDir(), "devices.json"))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(New(testRoutes(t, upstream.URL), store, []byte(testKey), nil, devices).Handler())
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
		Jar:       jar,
		Transport: &uaTransport{base: http.DefaultTransport, ua: "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"},
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

type uaTransport struct {
	base http.RoundTripper
	ua   string
}

func (t *uaTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.Header.Get("User-Agent") == "" {
		r.Header.Set("User-Agent", t.ua)
	}
	return t.base.RoundTrip(r)
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
	handler := New(testRoutes(t, upstream.URL), testStore(t), []byte(testKey), nil).Handler()

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
	server, _ := testServer(t, nil)
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

func TestDeviceName(t *testing.T) {
	cases := []struct{ agent, want string }{
		{"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36", "Chrome · Android"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "Safari · iOS"},
		{"Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1", "Safari · iOS"},
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0", "Edge · Windows"},
		{"Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0", "Firefox · Linux"},
		{"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Chrome · macOS"},
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0", "Firefox · Windows"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1", "Chrome · iOS"},
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 YaBrowser/24.1.0 Safari/537.36", "Yandex · Windows"},
		{"curl/8.4.0", "curl"},
		{"Go-http-client/1.1", "Go-клиент"},
		{"MyBot/2.0", "MyBot"},
		{"", "неизвестно"},
	}
	for _, test := range cases {
		if got := deviceName(test.agent); got != test.want {
			t.Fatalf("deviceName(%q) = %q, want %q", test.agent, got, test.want)
		}
	}
}

func TestDeviceStore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "devices.json")
	devices, err := OpenDevices(path)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Unix(1700000000, 0)
	devices.now = func() time.Time { return base }

	device, err := devices.Add("Friend", "Chrome · Android", "203.0.113.5")
	if err != nil {
		t.Fatal(err)
	}
	if device.User != "friend" || device.ID == "" || device.Seen != base.Unix() {
		t.Fatalf("device = %+v", device)
	}
	if !devices.Has("friend", device.ID) {
		t.Fatal("owner does not have the device")
	}
	if devices.Has("bongdo", device.ID) {
		t.Fatal("device leaked to another user")
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Fatalf("devices.json mode = %v", mode)
	}
	reopened, err := OpenDevices(path)
	if err != nil {
		t.Fatal(err)
	}
	if list := reopened.ListFor("friend"); len(list) != 1 || list[0].ID != device.ID {
		t.Fatalf("reopened list = %+v", list)
	}

	devices.Touch(device.ID, "198.51.100.7")
	if seen := devices.List()[0].Seen; seen != base.Unix() {
		t.Fatalf("seen updated inside the throttle window: %d", seen)
	}
	devices.now = func() time.Time { return base.Add(2 * time.Minute) }
	devices.Touch(device.ID, "198.51.100.7")
	moved := devices.List()[0]
	if moved.Seen != base.Add(2*time.Minute).Unix() || moved.IP != "198.51.100.7" {
		t.Fatalf("touch = %+v", moved)
	}

	other, err := devices.Add("friend", "Safari · iOS", "203.0.113.9")
	if err != nil {
		t.Fatal(err)
	}
	if list := devices.ListFor("friend"); len(list) != 2 {
		t.Fatalf("list for user = %+v", list)
	}
	if !devices.Has("friend", other.ID) {
		t.Fatal("second device is missing")
	}
	if len(devices.List()) != 2 {
		t.Fatalf("all devices = %+v", devices.List())
	}

	if err := devices.Remove(device.ID); err != nil {
		t.Fatal(err)
	}
	if devices.Has("friend", device.ID) {
		t.Fatal("device survived removal")
	}
	if err := devices.Remove(device.ID); err != ErrNoDevice {
		t.Fatalf("second removal = %v", err)
	}
	if len(devices.ListFor("friend")) != 1 {
		t.Fatal("removal took other devices too")
	}
}

func TestRemovedDeviceBecomesAnonymous(t *testing.T) {
	server, _, devices := testServerDevices(t, nil)
	client := noRedirect(t)
	if resp := login(t, client, server.URL, "friend", "member-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("member login = %d", resp.StatusCode)
	}
	own := devices.ListFor("friend")
	if len(own) != 1 {
		t.Fatalf("devices after login = %+v", own)
	}
	resp, err := client.Get(server.URL + "/account")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("account before removal = %d", resp.StatusCode)
	}

	if err := devices.Remove(own[0].ID); err != nil {
		t.Fatal(err)
	}
	resp, err = client.Get(server.URL + "/account")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("account after removal = %d, want 303", resp.StatusCode)
	}
	if location := resp.Header.Get("Location"); !strings.HasPrefix(location, "/login") {
		t.Fatalf("redirect = %q", location)
	}
	resp, err = client.Get(server.URL + "/share/thing/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("public route after removal = %d", resp.StatusCode)
	}
}

func userEpoch(t *testing.T, store *Store, name string) string {
	t.Helper()
	user, ok := store.Get(name)
	if !ok {
		t.Fatalf("user %q not found", name)
	}
	return user.Epoch()
}

func TestSessionWithoutDeviceAdoptsOne(t *testing.T) {
	server, store, devices := testServerDevices(t, nil)
	id := gateid.Identity{
		User:  "friend",
		Role:  gateid.RoleMember,
		Caps:  gateid.Caps(gateid.RoleMember),
		Exp:   time.Now().Add(time.Hour).Unix(),
		Epoch: userEpoch(t, store, "friend"),
	}
	req, err := http.NewRequest(http.MethodGet, server.URL+"/account", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0")
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: gateid.Sign([]byte(testKey), id)})
	resp, err := noRedirect(t).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("account = %d, want 200", resp.StatusCode)
	}
	own := devices.ListFor("friend")
	if len(own) != 1 || own[0].Name != "Firefox · Linux" {
		t.Fatalf("devices = %+v", own)
	}
	cookies := resp.Cookies()
	var renewedCookie *http.Cookie
	for _, cookie := range cookies {
		if cookie.Name == sessionCookie {
			renewedCookie = cookie
		}
	}
	if renewedCookie == nil || renewedCookie.Value == "" {
		t.Fatalf("session cookie not reissued: %+v", cookies)
	}
	renewed, err := gateid.Verify([]byte(testKey), renewedCookie.Value, time.Now())
	if err != nil || renewed.Dev != own[0].ID {
		t.Fatalf("renewed identity = %+v, err %v", renewed, err)
	}
}

func TestMemberCannotRemoveForeignDevice(t *testing.T) {
	server, _, devices := testServerDevices(t, nil)
	member := noRedirect(t)
	if resp := login(t, member, server.URL, "friend", "member-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("member login = %d", resp.StatusCode)
	}
	adminClient := noRedirect(t)
	if resp := login(t, adminClient, server.URL, "bongdo", "secret-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("admin login = %d", resp.StatusCode)
	}
	foreign := devices.ListFor("bongdo")
	if len(foreign) != 1 {
		t.Fatalf("admin devices = %+v", foreign)
	}

	resp, err := member.PostForm(server.URL+"/account/devices/remove", url.Values{"id": {foreign[0].ID}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign removal = %d, want 403", resp.StatusCode)
	}
	if !devices.Has("bongdo", foreign[0].ID) {
		t.Fatal("member removed another user's device")
	}
}

func TestAdminSeesAllDevices(t *testing.T) {
	server, _, devices := testServerDevices(t, nil)
	member := noRedirect(t)
	if resp := login(t, member, server.URL, "friend", "member-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("member login = %d", resp.StatusCode)
	}
	adminClient := noRedirect(t)
	if resp := login(t, adminClient, server.URL, "bongdo", "secret-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("admin login = %d", resp.StatusCode)
	}

	body := getBody(t, adminClient, server.URL+"/admin")
	adminSection := section(body, "устройства")
	for _, device := range devices.List() {
		if !strings.Contains(adminSection, device.ID) {
			t.Fatalf("admin page misses device %s of %s", device.ID, device.User)
		}
	}
	if got, want := strings.Count(adminSection, `action="/admin/devices/remove"`), len(devices.List()); got != want {
		t.Fatalf("admin page has %d disconnect buttons, want %d", got, want)
	}

	mine := devices.ListFor("friend")
	if len(mine) != 1 {
		t.Fatalf("member devices = %+v", mine)
	}
	memberSection := section(getBody(t, member, server.URL+"/account"), "устройства")
	if !strings.Contains(memberSection, "это устройство") {
		t.Fatal("account page does not mark the current device")
	}
	if got := strings.Count(memberSection, `action="/account/devices/remove"`); got != 0 {
		t.Fatalf("account page offers %d disconnect buttons for a single device", got)
	}
	for _, device := range devices.ListFor("bongdo") {
		if strings.Contains(memberSection, device.ID) {
			t.Fatal("account page shows another user's device")
		}
	}

	resp, err := adminClient.PostForm(server.URL+"/admin/devices/remove", url.Values{"id": {mine[0].ID}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("admin removal = %d, want 303", resp.StatusCode)
	}
	if devices.Has("friend", mine[0].ID) {
		t.Fatal("admin removal left the device in place")
	}
	resp, err = adminClient.PostForm(server.URL+"/admin/devices/remove", url.Values{"id": {"nope"}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("removal of an unknown device = %d, want 400", resp.StatusCode)
	}
}

func section(body, title string) string {
	start := strings.Index(body, "<h2>"+title+"</h2>")
	if start < 0 {
		return ""
	}
	rest := body[start:]
	if end := strings.Index(rest, "</section>"); end >= 0 {
		return rest[:end]
	}
	return rest
}

func getBody(t *testing.T, client *http.Client, url string) string {
	t.Helper()
	resp, err := client.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s = %d", url, resp.StatusCode)
	}
	return string(body)
}

func postForm(t *testing.T, client *http.Client, target string, form url.Values) (int, string) {
	t.Helper()
	resp, err := client.PostForm(target, form)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, string(body)
}

func fieldValue(t *testing.T, body, name string) string {
	t.Helper()
	match := regexp.MustCompile(`name="` + name + `" value="([^"]*)"`).FindStringSubmatch(body)
	if match == nil {
		t.Fatalf("field %q not found", name)
	}
	return match[1]
}

func secretField(t *testing.T, body string) string {
	t.Helper()
	match := regexp.MustCompile(`class="mono secret">([^<]+)<`).FindStringSubmatch(body)
	if match == nil {
		t.Fatal("secret not found")
	}
	return strings.ReplaceAll(match[1], " ", "")
}

func TestActiveAccountCannotBeRejected(t *testing.T) {
	server, store := testServer(t, nil)
	adminClient := noRedirect(t)
	if resp := login(t, adminClient, server.URL, "bongdo", "secret-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("admin login = %d", resp.StatusCode)
	}

	resp, err := adminClient.PostForm(server.URL+"/admin/reject", url.Values{"name": {"bongdo"}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("reject active account = %d, want 400", resp.StatusCode)
	}
	if _, ok := store.Get("bongdo"); !ok {
		t.Fatal("active account is gone")
	}
	if resp := login(t, noRedirect(t), server.URL, "bongdo", "secret-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("admin login after reject = %d", resp.StatusCode)
	}

	resp, err = adminClient.PostForm(server.URL+"/signup", url.Values{"name": {"newbie"}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	resp, err = adminClient.PostForm(server.URL+"/admin/reject", url.Values{"name": {"newbie"}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("reject pending = %d, want 303", resp.StatusCode)
	}
	if _, ok := store.Get("newbie"); ok {
		t.Fatal("pending request survived rejection")
	}
}

func TestAdminCannotSeeDeleteActionForActiveUsers(t *testing.T) {
	server, _ := testServer(t, nil)
	adminClient := noRedirect(t)
	if resp := login(t, adminClient, server.URL, "bongdo", "secret-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("admin login = %d", resp.StatusCode)
	}
	body := getBody(t, adminClient, server.URL+"/admin")
	active := body[strings.Index(body, "активные"):]
	devices := strings.Index(active, "устройства")
	if devices >= 0 {
		active = active[:devices]
	}
	if strings.Contains(active, "/admin/reject") {
		t.Fatal("active users still expose a delete action")
	}
}

func TestDeviceCookieReusesRow(t *testing.T) {
	server, _, devices := testServerDevices(t, nil)
	client := noRedirect(t)
	for i := 0; i < 2; i++ {
		if resp := login(t, client, server.URL, "friend", "member-pass"); resp.StatusCode != http.StatusSeeOther {
			t.Fatalf("login %d = %d", i, resp.StatusCode)
		}
	}
	if got := len(devices.ListFor("friend")); got != 1 {
		t.Fatalf("devices after two logins = %d, want 1", got)
	}
}

func TestDeviceRename(t *testing.T) {
	server, _, devices := testServerDevices(t, nil)
	member := noRedirect(t)
	if resp := login(t, member, server.URL, "friend", "member-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("member login = %d", resp.StatusCode)
	}
	own := devices.ListFor("friend")[0]
	resp, err := member.PostForm(server.URL+"/account/devices/rename", url.Values{"id": {own.ID}, "name": {"  мой   ноутбук "}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("rename = %d, want 303", resp.StatusCode)
	}
	if got := devices.ListFor("friend")[0].Name; got != "мой ноутбук" {
		t.Fatalf("renamed device = %q", got)
	}

	admin := noRedirect(t)
	if resp := login(t, admin, server.URL, "bongdo", "secret-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("admin login = %d", resp.StatusCode)
	}
	adminDevice := devices.ListFor("bongdo")[0]
	resp, err = member.PostForm(server.URL+"/account/devices/rename", url.Values{"id": {adminDevice.ID}, "name": {"чужой"}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign rename = %d, want 403", resp.StatusCode)
	}
	resp, err = admin.PostForm(server.URL+"/admin/devices/rename", url.Values{"id": {own.ID}, "name": {"ноутбук друга"}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if got := devices.ListFor("friend")[0].Name; got != "ноутбук друга" {
		t.Fatalf("admin rename = %q", got)
	}

	resp, err = admin.PostForm(server.URL+"/admin/devices/rename", url.Values{"id": {own.ID}, "name": {strings.Repeat("я", 41)}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if location := resp.Header.Get("Location"); !strings.Contains(location, "err=") {
		t.Fatalf("invalid name redirect = %q", location)
	}
	if got := devices.ListFor("friend")[0].Name; got != "ноутбук друга" {
		t.Fatalf("invalid rename changed the name to %q", got)
	}
}

func TestAuditKeepsNewest(t *testing.T) {
	audit := OpenAudit(filepath.Join(t.TempDir(), "audit.jsonl"))
	base := time.Unix(1700000000, 0)
	audit.now = func() time.Time { return base }
	for i := 0; i < 3; i++ {
		audit.Add(AuditEvent{User: "friend", Result: "ok"})
		base = base.Add(time.Second)
	}
	events := audit.Last(2)
	if len(events) != 2 {
		t.Fatalf("events = %d, want 2", len(events))
	}
	if events[0].Time <= events[1].Time {
		t.Fatalf("events are not newest first: %+v", events)
	}
}

func TestLoginWritesAudit(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	devices, err := OpenDevices(filepath.Join(t.TempDir(), "devices.json"))
	if err != nil {
		t.Fatal(err)
	}
	gateServer := New(testRoutes(t, upstream.URL), testStore(t), []byte(testKey), nil, devices)
	audit := OpenAudit(filepath.Join(t.TempDir(), "audit.jsonl"))
	gateServer.SetAudit(audit)
	server := httptest.NewServer(gateServer.Handler())
	defer server.Close()

	client := noRedirect(t)
	login(t, client, server.URL, "bongdo", "wrong-pass")
	login(t, client, server.URL, "bongdo", "secret-pass")

	events := audit.Last(2)
	if len(events) != 2 {
		t.Fatalf("audit events = %d, want 2", len(events))
	}
	if events[0].Result != "ok" || events[1].Result != "fail" {
		t.Fatalf("audit order = %+v", events)
	}
}

func assertSessionStatus(t *testing.T, client *http.Client, target string, want int) {
	t.Helper()
	resp, err := client.Get(target)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != want {
		t.Fatalf("GET %s = %d, want %d", target, resp.StatusCode, want)
	}
}

func assertLoggedOut(t *testing.T, client *http.Client, target string) {
	t.Helper()
	resp, err := client.Get(target)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther || !strings.HasPrefix(resp.Header.Get("Location"), "/login") {
		t.Fatalf("stale session = %d %q, want 303 to /login", resp.StatusCode, resp.Header.Get("Location"))
	}
}

func TestCredentialChangeEndsSessions(t *testing.T) {
	server, store, _ := testServerDevices(t, nil)
	client := noRedirect(t)
	if resp := login(t, client, server.URL, "friend", "member-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("login = %d", resp.StatusCode)
	}
	assertSessionStatus(t, client, server.URL+"/account", http.StatusOK)

	if err := store.SetPasswordHash("friend", "another-pass"); err != nil {
		t.Fatal(err)
	}
	assertLoggedOut(t, client, server.URL+"/account")

	fresh := noRedirect(t)
	if resp := login(t, fresh, server.URL, "friend", "another-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("login after password change = %d", resp.StatusCode)
	}

	const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	if err := store.SetTOTP("friend", secret, nil); err != nil {
		t.Fatal(err)
	}
	assertLoggedOut(t, fresh, server.URL+"/account")

	coded := noRedirect(t)
	code, err := totpAt(secret, totpStepOf(time.Now()))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := coded.PostForm(server.URL+"/login", url.Values{"name": {"friend"}, "code": {code}, "next": {"/"}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("code login = %d", resp.StatusCode)
	}
	assertSessionStatus(t, coded, server.URL+"/account", http.StatusOK)

	if err := store.ClearTOTP("friend"); err != nil {
		t.Fatal(err)
	}
	assertLoggedOut(t, coded, server.URL+"/account")
}

func TestTOTPEnableNeedsPassword(t *testing.T) {
	server, store, _ := testServerDevices(t, nil)
	client := noRedirect(t)
	if resp := login(t, client, server.URL, "bongdo", "secret-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("login = %d", resp.StatusCode)
	}

	for _, current := range []string{"", "wrong"} {
		status, _ := postForm(t, client, server.URL+"/account/totp/start", url.Values{"current": {current}})
		if status != http.StatusUnauthorized {
			t.Fatalf("start with current=%q = %d, want 401", current, status)
		}
		if user, _ := store.Get("bongdo"); user.TOTP != "" {
			t.Fatal("secret stored without the current password")
		}
	}

	status, body := postForm(t, client, server.URL+"/account/totp/start", url.Values{"current": {"secret-pass"}})
	if status != http.StatusOK {
		t.Fatalf("start = %d, want 200", status)
	}
	secret := secretField(t, body)
	pending := fieldValue(t, body, "pending")
	code, err := totpAt(secret, totpStepOf(time.Now()))
	if err != nil {
		t.Fatal(err)
	}

	status, _ = postForm(t, client, server.URL+"/account/totp/enable", url.Values{"pending": {pending}, "code": {code}, "current": {"wrong"}})
	if status != http.StatusUnauthorized {
		t.Fatalf("enable with a wrong password = %d, want 401", status)
	}
	if user, _ := store.Get("bongdo"); user.TOTP != "" {
		t.Fatal("totp enabled without the current password")
	}

	status, _ = postForm(t, client, server.URL+"/account/totp/enable", url.Values{"pending": {pending}, "code": {code}, "current": {"secret-pass"}})
	if status != http.StatusOK {
		t.Fatalf("enable = %d, want 200", status)
	}
	if user, _ := store.Get("bongdo"); user.TOTP != secret {
		t.Fatalf("stored secret = %q, want %q", user.TOTP, secret)
	}
}

func TestTOTPEnableRefusesSecondSecret(t *testing.T) {
	server, store, _ := testServerDevices(t, nil)
	const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	if err := store.SetTOTP("bongdo", secret, nil); err != nil {
		t.Fatal(err)
	}
	client := noRedirect(t)
	code, err := totpAt(secret, totpStepOf(time.Now()))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.PostForm(server.URL+"/login", url.Values{"name": {"bongdo"}, "code": {code}, "next": {"/"}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("code login = %d", resp.StatusCode)
	}

	status, body := postForm(t, client, server.URL+"/account/totp/start", url.Values{"current": {"secret-pass"}})
	if status != http.StatusBadRequest {
		t.Fatalf("start with 2FA on = %d, want 400", status)
	}
	if !strings.Contains(body, "уже включена") {
		t.Fatal("no message about the enabled 2FA")
	}
	if user, _ := store.Get("bongdo"); user.TOTP != secret {
		t.Fatal("existing secret was overwritten")
	}
}

func TestTOTPDisableNeedsPassword(t *testing.T) {
	server, store, _ := testServerDevices(t, nil)
	const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	if err := store.SetTOTP("bongdo", secret, nil); err != nil {
		t.Fatal(err)
	}
	client := noRedirect(t)
	step := totpStepOf(time.Now())
	code, err := totpAt(secret, step)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.PostForm(server.URL+"/login", url.Values{"name": {"bongdo"}, "code": {code}, "next": {"/"}})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("code login = %d", resp.StatusCode)
	}

	next, err := totpAt(secret, step+1)
	if err != nil {
		t.Fatal(err)
	}
	status, _ := postForm(t, client, server.URL+"/account/totp/disable", url.Values{"current": {"wrong"}, "code": {next}})
	if status != http.StatusUnauthorized {
		t.Fatalf("disable with a wrong password = %d, want 401", status)
	}
	if user, _ := store.Get("bongdo"); user.TOTP != secret {
		t.Fatal("totp disabled without the current password")
	}

	status, _ = postForm(t, client, server.URL+"/account/totp/disable", url.Values{"current": {"secret-pass"}, "code": {next}})
	if status != http.StatusOK {
		t.Fatalf("disable = %d, want 200", status)
	}
	if user, _ := store.Get("bongdo"); user.TOTP != "" {
		t.Fatal("totp still on")
	}
}

func TestAppSessionToken(t *testing.T) {
	t.Setenv("NIT_GATE_PASSWORD_HASH", "hash-one")
	now := time.Unix(1700000000, 0)
	token := appSessionToken("hash-one", now.Add(time.Hour))
	if !appSessionValid("hash-one", token, now) {
		t.Fatal("fresh token is not valid")
	}
	if appSessionValid("hash-two", token, now) {
		t.Fatal("token accepted for another hash")
	}
	if appSessionValid("hash-one", token, now.Add(2*time.Hour)) {
		t.Fatal("expired token accepted")
	}
}

func TestLoginSetsAppSession(t *testing.T) {
	t.Setenv("NIT_GATE_PASSWORD_HASH", "hash-one")
	server, _, _ := testServerDevices(t, nil)
	client := noRedirect(t)
	resp := login(t, client, server.URL, "bongdo", "secret-pass")
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("login = %d", resp.StatusCode)
	}
	var token string
	for _, cookie := range resp.Cookies() {
		if cookie.Name == appSessionCookie {
			token = cookie.Value
		}
	}
	if !appSessionValid("hash-one", token, time.Now()) {
		t.Fatalf("app session cookie = %q", token)
	}
}

func TestSessionRestoresAppSession(t *testing.T) {
	t.Setenv("NIT_GATE_PASSWORD_HASH", "hash-one")
	server, store, devices := testServerDevices(t, nil)
	login(t, noRedirect(t), server.URL, "friend", "member-pass")
	device := devices.ListFor("friend")[0]

	id := gateid.Identity{
		User:  "friend",
		Role:  gateid.RoleMember,
		Caps:  gateid.Caps(gateid.RoleMember),
		Dev:   device.ID,
		Exp:   time.Now().Add(time.Hour).Unix(),
		Epoch: userEpoch(t, store, "friend"),
	}
	req, err := http.NewRequest(http.MethodGet, server.URL+"/account", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: gateid.Sign([]byte(testKey), id)})
	resp, err := noRedirect(t).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("account = %d", resp.StatusCode)
	}
	var token string
	for _, cookie := range resp.Cookies() {
		if cookie.Name == appSessionCookie {
			token = cookie.Value
		}
	}
	if !appSessionValid("hash-one", token, time.Now()) {
		t.Fatalf("app session cookie not restored: %q", token)
	}
}

func TestTOTPVectors(t *testing.T) {
	const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	cases := []struct {
		unix int64
		want string
	}{
		{59, "287082"},
		{1111111109, "081804"},
		{1234567890, "005924"},
	}
	for _, tc := range cases {
		got, err := totpAt(secret, totpStepOf(time.Unix(tc.unix, 0)))
		if err != nil {
			t.Fatal(err)
		}
		if got != tc.want {
			t.Fatalf("code at %d = %s, want %s", tc.unix, got, tc.want)
		}
	}
}

func TestTOTPWindowAndReplay(t *testing.T) {
	const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	now := time.Unix(1234567890, 0)
	step := totpStepOf(now)
	code, err := totpAt(secret, step)
	if err != nil {
		t.Fatal(err)
	}
	used, ok := totpMatch(secret, code, now, 0)
	if !ok || used != step {
		t.Fatalf("fresh code rejected: %d %v", used, ok)
	}
	if _, ok := totpMatch(secret, code, now, step); ok {
		t.Fatal("replayed code accepted")
	}
	previous, err := totpAt(secret, step-1)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := totpMatch(secret, previous, now, 0); !ok {
		t.Fatal("code from the previous step rejected inside the window")
	}
	if _, ok := totpMatch(secret, previous, now, step); ok {
		t.Fatal("code from an older step accepted after use")
	}
}

func TestRecoveryCodeIsSingleUse(t *testing.T) {
	store := testStore(t)
	plain, hashed, err := newRecoveryCodes(2)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetTOTP("bongdo", "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", hashed); err != nil {
		t.Fatal(err)
	}
	if used, err := store.ConsumeRecovery("bongdo", plain[0]); err != nil || !used {
		t.Fatalf("first use = %v %v", used, err)
	}
	if used, _ := store.ConsumeRecovery("bongdo", plain[0]); used {
		t.Fatal("recovery code reused")
	}
	if used, _ := store.ConsumeRecovery("bongdo", plain[1]); !used {
		t.Fatal("second recovery code rejected")
	}
}

func TestTempLoginKeepsNoPersistentCookie(t *testing.T) {
	server, _, devices := testServerDevices(t, nil)
	client := noRedirect(t)
	form := strings.NewReader("name=bongdo&password=secret-pass&temp=1&next=/account")
	resp, err := client.Post(server.URL+"/login", "application/x-www-form-urlencoded", form)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("login = %d", resp.StatusCode)
	}
	if got := len(devices.List()); got != 1 {
		t.Fatalf("devices after temp login = %d, want 1", got)
	}
	var session *http.Cookie
	for _, cookie := range resp.Cookies() {
		if cookie.Name == sessionCookie {
			session = cookie
		}
	}
	if session == nil || session.MaxAge != 0 {
		t.Fatalf("temp session cookie = %+v, want a cookie without Max-Age", session)
	}
	id, err := gateid.Verify([]byte(testKey), session.Value, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if !id.Temp || id.Dev == "" {
		t.Fatalf("temp identity = %+v", id)
	}
	if ttl := time.Until(time.Unix(id.Exp, 0)); ttl > 12*time.Hour || ttl < 11*time.Hour {
		t.Fatalf("temp session ttl = %v, want 12h", ttl)
	}
	account, err := client.Get(server.URL + "/account")
	if err != nil {
		t.Fatal(err)
	}
	account.Body.Close()
	if account.StatusCode != http.StatusOK {
		t.Fatalf("account = %d", account.StatusCode)
	}
	if got := len(devices.List()); got != 1 {
		t.Fatalf("devices after visiting account = %d, want 1", got)
	}
}

func TestLoginByCodeOnly(t *testing.T) {
	server, store, _ := testServerDevices(t, nil)
	secret, err := newTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetTOTP("bongdo", secret, nil); err != nil {
		t.Fatal(err)
	}
	client := noRedirect(t)

	passwordOnly := login(t, client, server.URL, "bongdo", "secret-pass")
	if passwordOnly.StatusCode != http.StatusUnauthorized {
		t.Fatalf("password without a code = %d, want 401", passwordOnly.StatusCode)
	}

	code, err := totpAt(secret, totpStepOf(time.Now()))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.Post(server.URL+"/login", "application/x-www-form-urlencoded",
		strings.NewReader("name=bongdo&code="+code+"&next=/account"))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("code login = %d", resp.StatusCode)
	}
	account, err := client.Get(server.URL + "/account")
	if err != nil {
		t.Fatal(err)
	}
	account.Body.Close()
	if account.StatusCode != http.StatusOK {
		t.Fatalf("account after code login = %d", account.StatusCode)
	}

	replay, err := noRedirect(t).Post(server.URL+"/login", "application/x-www-form-urlencoded",
		strings.NewReader("name=bongdo&code="+code+"&next=/account"))
	if err != nil {
		t.Fatal(err)
	}
	replay.Body.Close()
	if replay.StatusCode != http.StatusUnauthorized {
		t.Fatalf("replayed code = %d, want 401", replay.StatusCode)
	}
}

func TestWrongCodesDoNotLockTheAccount(t *testing.T) {
	server, store, _ := testServerDevices(t, nil)
	secret, err := newTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetTOTP("bongdo", secret, nil); err != nil {
		t.Fatal(err)
	}
	client := noRedirect(t)
	wrong, err := totpAt(secret, totpStepOf(time.Now()))
	if err != nil {
		t.Fatal(err)
	}
	wrong = wrong[:5] + string("0123456789"[(int(wrong[5]-'0')+1)%10])

	attempt := func(ip, code string) int {
		req, err := http.NewRequest(http.MethodPost, server.URL+"/login",
			strings.NewReader("name=bongdo&code="+code+"&next=/"))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("X-Forwarded-For", ip)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}

	for i := 0; i < maxFailures; i++ {
		if got := attempt(fmt.Sprintf("10.0.0.%d", i+1), wrong); got != http.StatusUnauthorized {
			t.Fatalf("wrong code %d = %d, want 401", i+1, got)
		}
	}
	right, err := totpAt(secret, totpStepOf(time.Now()))
	if err != nil {
		t.Fatal(err)
	}
	if got := attempt("10.0.0.99", right); got != http.StatusSeeOther {
		t.Fatalf("correct code after %d wrong ones from other IPs = %d, want 303", maxFailures, got)
	}
}

func TestWrongCodesBlockOneIP(t *testing.T) {
	server, store, _ := testServerDevices(t, nil)
	secret, err := newTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetTOTP("bongdo", secret, nil); err != nil {
		t.Fatal(err)
	}
	client := noRedirect(t)
	wrong, err := totpAt(secret, totpStepOf(time.Now()))
	if err != nil {
		t.Fatal(err)
	}
	wrong = wrong[:5] + string("0123456789"[(int(wrong[5]-'0')+1)%10])

	attempt := func(code string) int {
		req, err := http.NewRequest(http.MethodPost, server.URL+"/login",
			strings.NewReader("name=bongdo&code="+code+"&next=/"))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("X-Forwarded-For", "10.0.0.7")
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}

	for i := 0; i < maxFailures; i++ {
		attempt(wrong)
	}
	if got := attempt(wrong); got != http.StatusTooManyRequests {
		t.Fatalf("wrong code after %d failures from one IP = %d, want 429", maxFailures, got)
	}
}

func TestEmptyCodeIsRefused(t *testing.T) {
	server, store, _ := testServerDevices(t, nil)
	secret, err := newTOTPSecret()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetTOTP("bongdo", secret, nil); err != nil {
		t.Fatal(err)
	}
	client := noRedirect(t)
	status, body := postForm(t, client, server.URL+"/login", url.Values{"name": {"bongdo"}, "code": {""}, "next": {"/"}})
	if status != http.StatusUnauthorized {
		t.Fatalf("empty code = %d, want 401", status)
	}
	if !strings.Contains(body, "введите код") {
		t.Fatalf("no hint about the missing code: %q", body)
	}
	if user, _ := store.Get("bongdo"); user.TOTPStep != 0 {
		t.Fatalf("empty code moved the step to %d", user.TOTPStep)
	}
}

func TestQRLogin(t *testing.T) {
	server, _, _ := testServerDevices(t, nil)
	desktop := noRedirect(t)

	page, err := desktop.Get(server.URL + "/login")
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(page.Body)
	page.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	match := regexp.MustCompile(`data-qr="([^"]+)"`).FindStringSubmatch(string(body))
	if match == nil {
		t.Fatal("no QR code on the login page")
	}
	code := match[1]

	phone := noRedirect(t)
	login(t, phone, server.URL, "friend", "member-pass")
	confirmPage, err := phone.Get(server.URL + "/qr/" + code)
	if err != nil {
		t.Fatal(err)
	}
	confirmPage.Body.Close()
	if confirmPage.StatusCode != http.StatusOK {
		t.Fatalf("confirm page = %d", confirmPage.StatusCode)
	}
	confirm, err := phone.Post(server.URL+"/qr/"+code, "application/x-www-form-urlencoded", nil)
	if err != nil {
		t.Fatal(err)
	}
	confirm.Body.Close()
	if confirm.StatusCode != http.StatusOK {
		t.Fatalf("confirm = %d", confirm.StatusCode)
	}

	status, err := desktop.Get(server.URL + "/qr/" + code + "/status?next=%2Faccount")
	if err != nil {
		t.Fatal(err)
	}
	var state map[string]string
	if err := json.NewDecoder(status.Body).Decode(&state); err != nil {
		t.Fatal(err)
	}
	status.Body.Close()
	if state["state"] != "ok" {
		t.Fatalf("status = %v", state)
	}
	account, err := desktop.Get(server.URL + "/account")
	if err != nil {
		t.Fatal(err)
	}
	account.Body.Close()
	if account.StatusCode != http.StatusOK {
		t.Fatalf("desktop account after QR = %d", account.StatusCode)
	}

	again, err := desktop.Get(server.URL + "/qr/" + code + "/status")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.NewDecoder(again.Body).Decode(&state); err != nil {
		t.Fatal(err)
	}
	again.Body.Close()
	if state["state"] != "expired" {
		t.Fatalf("second claim = %v, want expired", state)
	}
}

func TestSafeScanTarget(t *testing.T) {
	cases := []struct {
		raw  string
		host string
		want string
		ok   bool
	}{
		{"https://bongdo.space/qr/abc", "bongdo.space", "/qr/abc", true},
		{"https://evil.example/qr/abc", "bongdo.space", "", false},
		{"/qr/abc", "bongdo.space", "/qr/abc", true},
		{"//evil.example/x", "bongdo.space", "", false},
		{"javascript:alert(1)", "bongdo.space", "", false},
	}
	for _, tc := range cases {
		got, ok := safeScanTarget(tc.raw, tc.host)
		if ok != tc.ok || got != tc.want {
			t.Fatalf("safeScanTarget(%q) = %q %v, want %q %v", tc.raw, got, ok, tc.want, tc.ok)
		}
	}
}

func TestAutomationAgentKeepsNoDevice(t *testing.T) {
	for _, agent := range []string{"curl/8.5.0", "Wget/1.21", "Go-http-client/2.0", "python-requests/2.31", "Mozilla/5.0 HeadlessChrome/120.0"} {
		if !isAutomation(agent) {
			t.Fatalf("%q is not treated as automation", agent)
		}
	}
	for _, agent := range []string{"Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", "Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36"} {
		if isAutomation(agent) {
			t.Fatalf("%q is treated as automation", agent)
		}
	}

	server, _, devices := testServerDevices(t, nil)
	client := noRedirect(t)
	req, err := http.NewRequest(http.MethodPost, server.URL+"/login",
		strings.NewReader("name=bongdo&password=secret-pass&next=/"))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "curl/8.5.0")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("login = %d", resp.StatusCode)
	}
	if got := len(devices.List()); got != 0 {
		t.Fatalf("devices after curl login = %d, want 0", got)
	}
}

func TestOpenDevicesDropsAutomationRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "devices.json")
	body := `{"devices":[{"id":"a","user":"bongdo","name":"curl"},{"id":"b","user":"bongdo","name":"Headless Chrome · Linux"},{"id":"c","user":"bongdo","name":"Firefox · Linux"}]}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	devices, err := OpenDevices(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := devices.List(); len(got) != 1 || got[0].ID != "c" {
		t.Fatalf("kept devices = %+v", got)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), `"curl"`) {
		t.Fatal("automation rows are still on disk")
	}
}

func TestUpstreamFailureRateLimit(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	s := &Server{now: func() time.Time { return now }}

	if got := s.upstreamFailure(); got != 0 {
		t.Fatalf("first failure = %d, want 0", got)
	}
	if got := s.upstreamFailure(); got != -1 {
		t.Fatalf("second failure = %d, want suppressed", got)
	}
	if got := s.upstreamFailure(); got != -1 {
		t.Fatalf("third failure = %d, want suppressed", got)
	}
	now = now.Add(6 * time.Second)
	if got := s.upstreamFailure(); got != 2 {
		t.Fatalf("failure after window = %d, want 2 suppressed", got)
	}
}
