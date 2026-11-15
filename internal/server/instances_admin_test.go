package server_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"nitgui/internal/opencode"
)

func testInstanceProvider(t *testing.T) (*multiProvider, string) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("NIT_GUI_STATE", filepath.Join(dir, "ui-state.json"))
	provider := &multiProvider{
		clients:    map[string]*opencode.Client{},
		specs:      []opencode.InstanceSpec{{Name: "local"}},
		def:        "local",
		configPath: filepath.Join(dir, "instances.json"),
	}
	return provider, dir
}

func postInstance(t *testing.T, handler http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7788/api/instances", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(rec, request)
	return rec
}

func TestSaveInstanceRejectsSSHOption(t *testing.T) {
	provider, _ := testInstanceProvider(t)
	handler := newMultiHandler(t, provider)

	rec := postInstance(t, handler, `{"name":"evil","transport":"ssh","ssh":"-oProxyCommand=touch /tmp/nit-gui-pwn"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if len(provider.Instances()) != 1 {
		t.Fatalf("instance was saved: %+v", provider.Instances())
	}
}

func TestSaveInstanceRejectsPasswordFileOutsideConfig(t *testing.T) {
	provider, _ := testInstanceProvider(t)
	handler := newMultiHandler(t, provider)

	rec := postInstance(t, handler, `{"name":"office","transport":"url","url":"http://10.0.0.5:49374","password":"pw","passwordFile":"/etc/passwd"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if len(provider.Instances()) != 1 {
		t.Fatalf("instance was saved: %+v", provider.Instances())
	}
}

func TestSaveInstanceAppLinks(t *testing.T) {
	provider, _ := testInstanceProvider(t)
	handler := newMultiHandler(t, provider)

	create := `{"name":"riga","transport":"ssh","ssh":"riga-dev","peroURL":"https://riga.example/pero/","termURL":"/term/riga/"}`
	if rec := postInstance(t, handler, create); rec.Code != http.StatusOK {
		t.Fatalf("create = %d: %s", rec.Code, rec.Body)
	}
	specs := provider.Instances()
	if len(specs) != 2 || specs[1].PeroURL != "https://riga.example/pero/" || specs[1].TermURL != "/term/riga/" {
		t.Fatalf("specs = %+v", specs)
	}

	edit := `{"original":"riga","name":"riga","transport":"ssh","ssh":"riga-dev","dir":"/srv"}`
	if rec := postInstance(t, handler, edit); rec.Code != http.StatusOK {
		t.Fatalf("edit = %d: %s", rec.Code, rec.Body)
	}
	specs = provider.Instances()
	if specs[1].PeroURL != "https://riga.example/pero/" || specs[1].TermURL != "/term/riga/" {
		t.Fatalf("app urls not preserved: %+v", specs[1])
	}

	clear := `{"original":"riga","name":"riga","transport":"ssh","ssh":"riga-dev","peroURL":""}`
	if rec := postInstance(t, handler, clear); rec.Code != http.StatusOK {
		t.Fatalf("clear = %d: %s", rec.Code, rec.Body)
	}
	specs = provider.Instances()
	if specs[1].PeroURL != "" || specs[1].TermURL != "/term/riga/" {
		t.Fatalf("clear rule = %+v", specs[1])
	}

	for _, body := range []string{
		`{"original":"riga","name":"riga","transport":"ssh","ssh":"riga-dev","peroURL":"ftp://example.com/pero/"}`,
		`{"original":"riga","name":"riga","transport":"ssh","ssh":"riga-dev","termURL":"https://user:pass@example.com/term/"}`,
		`{"original":"riga","name":"riga","transport":"ssh","ssh":"riga-dev","termURL":"term/"}`,
	} {
		if rec := postInstance(t, handler, body); rec.Code != http.StatusBadRequest {
			t.Fatalf("invalid app url %s = %d: %s", body, rec.Code, rec.Body)
		}
	}
	if provider.Instances()[1].TermURL != "/term/riga/" {
		t.Fatalf("rejected save changed the spec: %+v", provider.Instances()[1])
	}

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/instances", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("instances = %d: %s", rec.Code, rec.Body)
	}
	var list struct {
		Defaults struct {
			PeroURL string `json:"peroURL"`
			TermURL string `json:"termURL"`
		} `json:"defaults"`
		Instances []struct {
			ID      string `json:"id"`
			PeroURL string `json:"peroURL"`
			TermURL string `json:"termURL"`
		} `json:"instances"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if list.Defaults.PeroURL != "/pero/" || list.Defaults.TermURL != "/term/" {
		t.Fatalf("defaults = %+v", list.Defaults)
	}
	if len(list.Instances) != 2 || list.Instances[1].PeroURL != "" || list.Instances[1].TermURL != "/term/riga/" {
		t.Fatalf("instances = %+v", list.Instances)
	}
}

func TestSaveInstanceAcceptsPasswordFileInsideConfig(t *testing.T) {
	provider, dir := testInstanceProvider(t)
	handler := newMultiHandler(t, provider)
	path := filepath.Join(dir, "office.password")

	rec := postInstance(t, handler, `{"name":"office","transport":"url","url":"http://10.0.0.5:49374","password":"pw","passwordFile":"`+path+`"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(raw)) != "pw" {
		t.Fatalf("password file = %q", raw)
	}
}

func TestSaveInstanceRejectsSymlinkPasswordFile(t *testing.T) {
	provider, dir := testInstanceProvider(t)
	handler := newMultiHandler(t, provider)
	target := filepath.Join(dir, "real.password")
	if err := os.WriteFile(target, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link.password")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink unsupported: %v", err)
	}

	rec := postInstance(t, handler, `{"name":"office","transport":"url","url":"http://10.0.0.5:49374","password":"pw","passwordFile":"`+link+`"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	raw, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "old" {
		t.Fatalf("target was overwritten: %q", raw)
	}
}
