package opencode

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func writeInstances(t *testing.T, body string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "instances.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("NIT_GUI_INSTANCES", path)
}

func TestRegistryMissingConfig(t *testing.T) {
	t.Setenv("NIT_GUI_INSTANCES", filepath.Join(t.TempDir(), "absent.json"))
	r := NewRegistry()
	defer r.Close()
	if got := r.ConfigError(); got != "" {
		t.Fatalf("ConfigError() = %q, want empty", got)
	}
	specs := r.Instances()
	if len(specs) != 1 || specs[0].Name != "local" {
		t.Fatalf("Instances() = %+v, want one local spec", specs)
	}
	if got := r.DefaultInstance(); got != "local" {
		t.Fatalf("DefaultInstance() = %q, want local", got)
	}
}

func TestRegistryEmptyList(t *testing.T) {
	writeInstances(t, `{"instances":[]}`)
	r := NewRegistry()
	defer r.Close()
	if got := r.ConfigError(); got != "" {
		t.Fatalf("ConfigError() = %q, want empty", got)
	}
	if got := r.DefaultInstance(); got != "local" {
		t.Fatalf("DefaultInstance() = %q, want local", got)
	}
}

func TestRegistryParsesOrder(t *testing.T) {
	writeInstances(t, `{"instances":[
		{"name":"frankfurt","url":"auto"},
		{"name":"riga","ssh":"riga-dev","dir":"/home/bongdo/Projects","passwordFile":"~/.config/nit-gui/riga.password"},
		{"name":"office","url":"http://10.0.0.5:49374","passwordFile":"/tmp/office.password"}
	]}`)
	r := NewRegistry()
	defer r.Close()
	if got := r.ConfigError(); got != "" {
		t.Fatalf("ConfigError() = %q, want empty", got)
	}
	specs := r.Instances()
	if len(specs) != 3 {
		t.Fatalf("len(Instances()) = %d, want 3", len(specs))
	}
	if specs[0].Name != "frankfurt" || specs[1].Name != "riga" || specs[2].Name != "office" {
		t.Fatalf("Instances() order = %+v", specs)
	}
	if got := r.DefaultInstance(); got != "frankfurt" {
		t.Fatalf("DefaultInstance() = %q, want frankfurt", got)
	}
	if got := r.Transport("frankfurt"); got != "local" {
		t.Fatalf("Transport(frankfurt) = %q", got)
	}
	if got := r.Detail("riga"); got != "ssh riga-dev" {
		t.Fatalf("Detail(riga) = %q", got)
	}
	if got := r.Detail("office"); got != "http://10.0.0.5:49374" {
		t.Fatalf("Detail(office) = %q", got)
	}
	spec, ok := r.Spec("office")
	if !ok || spec.PasswordFile != "/tmp/office.password" {
		t.Fatalf("Spec(office) = %+v, %v", spec, ok)
	}
	if !filepath.IsAbs(specs[1].PasswordFile) {
		t.Fatalf("passwordFile not expanded: %q", specs[1].PasswordFile)
	}
}

func TestRegistryConfigErrors(t *testing.T) {
	cases := map[string]string{
		"duplicate": `{"instances":[{"name":"a","url":"auto"},{"name":"a","url":"auto"}]}`,
		"invalid":   `{"instances":[{"name":"bad name","url":"auto"}]}`,
		"empty":     `{"instances":[{"name":"","url":"auto"}]}`,
		"both":      `{"instances":[{"name":"a","url":"http://127.0.0.1:1234","ssh":"host"}]}`,
		"garbage":   `not json`,
	}
	for label, body := range cases {
		t.Run(label, func(t *testing.T) {
			writeInstances(t, body)
			r := NewRegistry()
			defer r.Close()
			if r.ConfigError() == "" {
				t.Fatalf("ConfigError() empty for %s", label)
			}
			specs := r.Instances()
			if len(specs) != 1 || specs[0].Name != "local" {
				t.Fatalf("fallback Instances() = %+v", specs)
			}
			if r.HasInstance("a") {
				t.Fatal("config error should not keep parsed instances")
			}
		})
	}
}

func TestRegistryClientForExplicitURL(t *testing.T) {
	const password = "sekrit"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || user != "opencode" || pass != password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path != "/api/info" {
			http.NotFound(w, r)
			return
		}
		_, _ = io.WriteString(w, `{"version":"1"}`)
	}))
	defer srv.Close()

	writeInstances(t, `{"instances":[{"name":"office","url":"`+srv.URL+`","password":"`+password+`"}]}`)
	r := NewRegistry()
	defer r.Close()
	ctx := context.Background()

	c, err := r.ClientFor(ctx, "office")
	if err != nil {
		t.Fatalf("ClientFor: %v", err)
	}
	if c.BaseURL != srv.URL {
		t.Fatalf("BaseURL = %q, want %q", c.BaseURL, srv.URL)
	}
	var out struct {
		Version string `json:"version"`
	}
	if err := c.Do(ctx, http.MethodGet, "/api/info", nil, &out); err != nil {
		t.Fatalf("Do: %v", err)
	}
	if out.Version != "1" {
		t.Fatalf("version = %q", out.Version)
	}
	if !r.Connected("office") {
		t.Fatal("Connected(office) = false after successful client")
	}
	if got := r.LastError("office"); got != "" {
		t.Fatalf("LastError = %q", got)
	}
}

func TestRegistryUnknownInstance(t *testing.T) {
	writeInstances(t, `{"instances":[{"name":"office","url":"http://127.0.0.1:1"}]}`)
	r := NewRegistry()
	defer r.Close()
	if _, err := r.ClientFor(context.Background(), "nope"); !errors.Is(err, ErrUnknownInstance) {
		t.Fatalf("ClientFor(nope) error = %v, want ErrUnknownInstance", err)
	}
	if r.Connected("nope") || r.HasInstance("nope") || r.LastError("nope") != "" {
		t.Fatal("unknown instance should report empty state")
	}
}

func TestRegistryClientUsesDefault(t *testing.T) {
	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer first.Close()
	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer second.Close()

	writeInstances(t, `{"instances":[
		{"name":"first","url":"`+first.URL+`"},
		{"name":"second","url":"`+second.URL+`"}
	]}`)
	r := NewRegistry()
	defer r.Close()
	c, err := r.Client(context.Background())
	if err != nil {
		t.Fatalf("Client: %v", err)
	}
	if c.BaseURL != first.URL {
		t.Fatalf("Client().BaseURL = %q, want %q", c.BaseURL, first.URL)
	}
	r.Drop()
	if r.Connected("first") {
		t.Fatal("Drop did not clear default client")
	}
}

func TestRegistryLastError(t *testing.T) {
	writeInstances(t, `{"instances":[{"name":"office","url":"ftp://example.com","password":"topsecret"}]}`)
	r := NewRegistry()
	defer r.Close()
	if _, err := r.ClientFor(context.Background(), "office"); err == nil {
		t.Fatal("expected connection failure")
	}
	msg := r.LastError("office")
	if msg == "" {
		t.Fatal("LastError is empty after failure")
	}
	if msg == "topsecret" {
		t.Fatal("LastError leaked the password")
	}
}

func TestEndpointRefreshAfterUnauthorized(t *testing.T) {
	var mu sync.Mutex
	var seen []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, pass, _ := r.BasicAuth()
		mu.Lock()
		seen = append(seen, pass)
		mu.Unlock()
		if pass != "new" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer srv.Close()

	c := New(Endpoint{
		URL:      srv.URL,
		Password: "old",
		Refresh:  func() (string, bool) { return "new", true },
	})
	if err := c.Do(context.Background(), http.MethodGet, "/api/info", nil, nil); err != nil {
		t.Fatalf("Do: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(seen) != 2 || seen[0] != "old" || seen[1] != "new" {
		t.Fatalf("auth attempts = %v, want [old new]", seen)
	}
	if c.password() != "new" {
		t.Fatalf("password not refreshed, got %q", c.password())
	}
}

func TestParseServiceURL(t *testing.T) {
	got, err := parseServiceURL("server running\nhttp://127.0.0.1:49374\n")
	if err != nil {
		t.Fatalf("parseServiceURL: %v", err)
	}
	if got != "http://127.0.0.1:49374" {
		t.Fatalf("parseServiceURL = %q", got)
	}
	if _, err := parseServiceURL("nothing here"); err == nil {
		t.Fatal("parseServiceURL accepted empty output")
	}
}

func TestFreePort(t *testing.T) {
	port, err := freePort()
	if err != nil {
		t.Fatalf("freePort: %v", err)
	}
	if port <= 0 || port > 65535 {
		t.Fatalf("freePort = %d", port)
	}
}

func TestRegistryReplaceWritesAndReloads(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "instances.json")
	t.Setenv("NIT_GUI_INSTANCES", path)
	r := NewRegistry()
	defer r.Close()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/info" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if user, pass, ok := r.BasicAuth(); !ok || user != "opencode" || pass != "pw" {
			t.Errorf("unexpected auth %q %q %v", user, pass, ok)
		}
		_, _ = io.WriteString(w, `{"version":"9.9.9"}`)
	}))
	defer upstream.Close()

	if err := r.Replace([]InstanceSpec{
		{Name: "frankfurt", URL: "auto"},
		{Name: "office", URL: upstream.URL, PasswordFile: filepath.Join(dir, "office.password")},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.ClientFor(context.Background(), "office"); err == nil {
		t.Fatal("missing password file should fail the connection")
	}

	pw := filepath.Join(dir, "office.password")
	if err := os.WriteFile(pw, []byte("pw\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := r.Replace([]InstanceSpec{
		{Name: "frankfurt", URL: "auto"},
		{Name: "office", URL: upstream.URL, PasswordFile: pw, Dir: "/srv/projects"},
	}); err != nil {
		t.Fatal(err)
	}
	if got := r.DefaultInstance(); got != "frankfurt" {
		t.Fatalf("DefaultInstance() = %q", got)
	}
	specs := r.Instances()
	if len(specs) != 2 || specs[0].Name != "frankfurt" || specs[1].Name != "office" {
		t.Fatalf("Instances() = %+v", specs)
	}
	if !r.HasInstance("office") || r.Transport("office") != "url" {
		t.Fatalf("office not loaded: %+v", specs)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("config mode = %o, want 600", info.Mode().Perm())
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"name": "office"`) || strings.Contains(string(raw), "pw\n") {
		t.Fatalf("unexpected config: %s", raw)
	}
	client, err := r.ClientFor(context.Background(), "office")
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Version string `json:"version"`
	}
	if err := client.Do(context.Background(), http.MethodGet, "/api/info", nil, &out); err != nil {
		t.Fatal(err)
	}
	if out.Version != "9.9.9" {
		t.Fatalf("version = %q", out.Version)
	}
}

func TestValidAppURL(t *testing.T) {
	cases := map[string]bool{
		"":                                    true,
		"/pero/":                              true,
		"/ed":                                 true,
		"https://frankfurt.example/pero/":     true,
		"http://127.0.0.1:7795/term/":         true,
		"ftp://example.com/pero/":             false,
		"pero/":                               false,
		"//evil.example/pero/":                false,
		"https://user:pass@example.com/pero/": false,
		"https:///pero/":                      false,
		"https://example.com/ a":              false,
	}
	for raw, want := range cases {
		if got := ValidAppURL(raw); got != want {
			t.Fatalf("ValidAppURL(%q) = %v, want %v", raw, got, want)
		}
	}
}

func TestRegistryAppURLsRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "instances.json")
	t.Setenv("NIT_GUI_INSTANCES", path)
	r := NewRegistry()
	defer r.Close()

	if err := r.Replace([]InstanceSpec{
		{Name: "riga", SSH: "riga-dev", PeroURL: "https://riga.example/pero/", TermURL: "/term/riga/"},
	}); err != nil {
		t.Fatal(err)
	}
	spec, ok := r.Spec("riga")
	if !ok || spec.PeroURL != "https://riga.example/pero/" || spec.TermURL != "/term/riga/" {
		t.Fatalf("Spec(riga) = %+v, %v", spec, ok)
	}

	if err := r.Replace([]InstanceSpec{{Name: "riga", SSH: "riga-dev"}}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "peroURL") || strings.Contains(string(raw), "termURL") {
		t.Fatalf("cleared app urls were saved: %s", raw)
	}
}

func TestRegistryReplaceValidation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "instances.json")
	t.Setenv("NIT_GUI_INSTANCES", path)
	r := NewRegistry()
	defer r.Close()
	cases := [][]InstanceSpec{
		nil,
		{{Name: "bad name"}},
		{{Name: "a"}, {Name: "a"}},
		{{Name: "a", Dir: "relative"}},
		{{Name: "a", URL: "http://x", SSH: "host"}},
		{{Name: "a", PeroURL: "ftp://example.com/pero/"}},
		{{Name: "a", TermURL: "https://user:pass@example.com/term/"}},
	}
	for _, specs := range cases {
		if err := r.Replace(specs); err == nil {
			t.Fatalf("Replace(%+v) succeeded", specs)
		}
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("invalid Replace wrote config: %v", err)
	}
}

func TestRegistryReloadInvalidKeepsOld(t *testing.T) {
	path := filepath.Join(t.TempDir(), "instances.json")
	t.Setenv("NIT_GUI_INSTANCES", path)
	r := NewRegistry()
	defer r.Close()
	if err := os.WriteFile(path, []byte(`{"instances":[{"name":"bad name"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := r.Reload(); err == nil {
		t.Fatal("Reload accepted invalid config")
	}
	if got := r.DefaultInstance(); got != "local" {
		t.Fatalf("DefaultInstance() = %q after failed reload", got)
	}
}
