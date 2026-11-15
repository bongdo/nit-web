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

func TestSessionWithoutDeviceAdoptsOne(t *testing.T) {
	server, _, devices := testServerDevices(t, nil)
	id := gateid.Identity{
		User: "friend",
		Role: gateid.RoleMember,
		Caps: gateid.Caps(gateid.RoleMember),
		Exp:  time.Now().Add(time.Hour).Unix(),
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
	agents, err := OpenAgents(filepath.Join(t.TempDir(), "agents.json"))
	if err != nil {
		t.Fatal(err)
	}
	devices, err := OpenDevices(filepath.Join(t.TempDir(), "devices.json"))
	if err != nil {
		t.Fatal(err)
	}
	gateServer := New(testRoutes(t, upstream.URL), testStore(t), agents, []byte(testKey), nil, devices)
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

func TestProbeService(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer up.Close()
	if status := probeService(up.Client(), up.URL); !status.Up {
		t.Fatalf("upstream reported down: %+v", status)
	}
	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer broken.Close()
	if status := probeService(broken.Client(), broken.URL); status.Up {
		t.Fatalf("502 reported up: %+v", status)
	}
}
