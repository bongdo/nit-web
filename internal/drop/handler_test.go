package drop

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testDropServer(t *testing.T, store *Store, authenticated func(*http.Request) bool) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.Handle("/drop/", NewManager(store, func(*http.Request) bool { return true }, nil, "/pero/", ""))
	mux.Handle("/d/", NewPublic(store, authenticated, nil, ""))
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func noRedirectClient() *http.Client {
	return &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
}

func TestIndexAndStatic(t *testing.T) {
	store := testStore(t)
	server := testDropServer(t, store, nil)
	for _, target := range []string{"/drop/", "/drop/static/drop.css", "/drop/static/drop.js"} {
		resp, err := http.Get(server.URL + target)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s status = %d", target, resp.StatusCode)
		}
		if target == "/drop/" {
			if !strings.Contains(string(body), "data-dropzone") {
				t.Fatal("index has no upload zone")
			}
			for _, noise := range []string{"Временный буфер", "Пароль общий", "sandbox", "Агент: drop"} {
				if strings.Contains(string(body), noise) {
					t.Fatalf("index still contains %q", noise)
				}
			}
		}
	}
}

func TestPublicAndPrivate(t *testing.T) {
	store := testStore(t)
	public := publishFile(t, store, "public.txt", "public body", PublishOptions{Public: true})
	private := publishFile(t, store, "private.txt", "private body", PublishOptions{})
	allow := false
	server := testDropServer(t, store, func(*http.Request) bool { return allow })

	resp, err := http.Get(server.URL + "/d/" + public.Slug + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || string(body) != "public body" {
		t.Fatalf("public status = %d body = %q", resp.StatusCode, body)
	}

	resp, err = http.Get(server.URL + "/d/" + private.Slug + "/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("private anonymous status = %d, want 404", resp.StatusCode)
	}

	allow = true
	resp, err = http.Get(server.URL + "/d/" + private.Slug + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || string(body) != "private body" {
		t.Fatalf("private authenticated status = %d body = %q", resp.StatusCode, body)
	}
}

func TestOldURLRedirects(t *testing.T) {
	store := testStore(t)
	entry := publishFile(t, store, "report.md", "# hi", PublishOptions{})
	server := testDropServer(t, store, nil)
	client := noRedirectClient()
	base := "/d/" + entry.Slug + "/"

	cases := []struct {
		target string
		want   string
	}{
		{"/drop/e/" + entry.ID + "/", base},
		{"/drop/e/" + entry.ID + "/?file=report.md", base + "report.md"},
		{"/drop/files/" + entry.ID, base},
		{"/drop/files/" + entry.ID + "/report.md", base + "report.md"},
		{"/drop/download/" + entry.ID, base},
		{"/drop/download/" + entry.ID + "/report.md", base + "report.md"},
	}
	for _, item := range cases {
		resp, err := client.Get(server.URL + item.target)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusMovedPermanently || resp.Header.Get("Location") != item.want {
			t.Errorf("%s = %d %q, want 301 %q", item.target, resp.StatusCode, resp.Header.Get("Location"), item.want)
		}
	}
}

func TestBasePathRedirects(t *testing.T) {
	store := testStore(t)
	src := t.TempDir()
	writeFile(t, filepath.Join(src, "sub", "a.txt"), "a")
	entry, err := store.PublishPath(src, "folder", PublishOptions{Public: true})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/drop/", NewManager(store, func(*http.Request) bool { return true }, nil, "/pero/", "/nit"))
	mux.Handle("/d/", NewPublic(store, nil, nil, "/nit"))
	server := httptest.NewServer(mux)
	defer server.Close()
	client := noRedirectClient()

	resp, err := client.Get(server.URL + "/drop/e/" + entry.ID + "/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusMovedPermanently || resp.Header.Get("Location") != "/nit/d/folder/" {
		t.Fatalf("old entry redirect = %d %q", resp.StatusCode, resp.Header.Get("Location"))
	}

	resp, err = client.Get(server.URL + "/d/folder/sub")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusMovedPermanently || resp.Header.Get("Location") != "/nit/d/folder/sub/" {
		t.Fatalf("directory redirect = %d %q", resp.StatusCode, resp.Header.Get("Location"))
	}
}

func TestUploadUpdateAliasAndDelete(t *testing.T) {
	store := testStore(t)
	server := testDropServer(t, store, nil)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "note.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("# uploaded")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	resp, err := http.Post(server.URL+"/drop/api/upload", writer.FormDataContentType(), &body)
	if err != nil {
		t.Fatal(err)
	}
	var created struct {
		ID      string `json:"id"`
		Slug    string `json:"slug"`
		URL     string `json:"url"`
		Public  bool   `json:"public"`
		Forever bool   `json:"forever"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || created.ID == "" || created.Slug != "note" || created.Public || !created.Forever || created.URL != "/d/note/" {
		t.Fatalf("upload = %d %+v", resp.StatusCode, created)
	}

	resp, err = http.Get(server.URL + "/d/note/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("private upload status = %d", resp.StatusCode)
	}

	entry := patch(t, server.URL, created.ID, map[string]any{"public": true})
	if !entry.Public {
		t.Fatalf("public patch = %+v", entry)
	}
	resp, err = http.Get(server.URL + "/d/note/")
	if err != nil {
		t.Fatal(err)
	}
	bodyText, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || string(bodyText) != "# uploaded" {
		t.Fatalf("public read = %d %q", resp.StatusCode, bodyText)
	}

	entry = patch(t, server.URL, created.ID, map[string]any{"slug": "renamed"})
	if entry.Slug != "renamed" {
		t.Fatalf("slug patch = %+v", entry)
	}
	for _, target := range []string{"/d/renamed/", "/d/note/"} {
		resp, err := http.Get(server.URL + target)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s after rename = %d", target, resp.StatusCode)
		}
	}

	entry = patch(t, server.URL, created.ID, map[string]any{"forever": false})
	if entry.Forever() || entry.Expires == nil {
		t.Fatalf("expiry patch = %+v", entry)
	}
	entry = patch(t, server.URL, created.ID, map[string]any{"forever": true})
	if !entry.Forever() || entry.Expires != nil {
		t.Fatalf("forever patch = %+v", entry)
	}

	req, _ := http.NewRequest(http.MethodDelete, server.URL+"/drop/api/entries/"+created.ID, nil)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete = %d", resp.StatusCode)
	}
	resp, err = http.Get(server.URL + "/d/renamed/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("after delete = %d", resp.StatusCode)
	}
}

func patch(t *testing.T, base, id string, value map[string]any) Entry {
	t.Helper()
	data, _ := json.Marshal(value)
	req, _ := http.NewRequest(http.MethodPatch, base+"/drop/api/entries/"+id, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("patch %v = %d %s", value, resp.StatusCode, body)
	}
	var entry Entry
	if err := json.NewDecoder(resp.Body).Decode(&entry); err != nil {
		t.Fatal(err)
	}
	return entry
}

func TestAppIsSandboxedAndDirect(t *testing.T) {
	store := testStore(t)
	src := t.TempDir()
	writeFile(t, filepath.Join(src, "index.html"), "<!doctype html><h1>app</h1>")
	writeFile(t, filepath.Join(src, "app.js"), "console.log(1)")
	entry, err := store.PublishPath(src, "app", PublishOptions{Public: true})
	if err != nil {
		t.Fatal(err)
	}
	server := testDropServer(t, store, nil)
	resp, err := http.Get(server.URL + "/d/" + entry.Slug + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), "<h1>app</h1>") {
		t.Fatalf("app status = %d body = %q", resp.StatusCode, body)
	}
	if !strings.Contains(resp.Header.Get("Content-Security-Policy"), "sandbox") {
		t.Fatal("app response has no sandbox CSP")
	}
	if strings.Contains(string(body), "iframe") {
		t.Fatal("app is wrapped in an iframe")
	}

	resp, err = http.Get(server.URL + "/d/" + entry.Slug + "/app.js")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("asset status = %d", resp.StatusCode)
	}
}

func TestAutoindex(t *testing.T) {
	store := testStore(t)
	src := t.TempDir()
	writeFile(t, filepath.Join(src, "a.txt"), "a")
	writeFile(t, filepath.Join(src, "b.txt"), "b")
	writeFile(t, filepath.Join(src, ".hidden"), "hidden")
	entry, err := store.PublishPath(src, "files", PublishOptions{Public: true})
	if err != nil {
		t.Fatal(err)
	}
	server := testDropServer(t, store, nil)
	resp, err := http.Get(server.URL + "/d/" + entry.Slug + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	for _, want := range []string{"/d/files/a.txt", "/d/files/b.txt"} {
		if !strings.Contains(string(body), want) {
			t.Fatalf("autoindex missing %q: %s", want, body)
		}
	}
	if strings.Contains(string(body), ".hidden") {
		t.Fatal("autoindex lists a dotfile")
	}
}

func TestPeroLinksAndRawDoc(t *testing.T) {
	store := testStore(t)
	src := t.TempDir()
	writeFile(t, filepath.Join(src, "index.md"), "# doc")
	entry, err := store.PublishPath(src, "docs", PublishOptions{})
	if err != nil {
		t.Fatal(err)
	}
	server := testDropServer(t, store, nil)
	resp, err := http.Get(server.URL + "/drop/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("index = %d", resp.StatusCode)
	}
	if !strings.Contains(string(body), "/pero/?open=") {
		t.Fatal("index has no pero link")
	}
	if !strings.Contains(string(body), "/d/"+entry.Slug+"/index.md") {
		t.Fatal("index has no raw doc link")
	}
	if !strings.Contains(string(body), url.QueryEscape(filepath.Join(store.Root(), entry.ID, "index.md"))) {
		t.Fatal("pero link does not contain the absolute path")
	}
}

func TestWriteGuard(t *testing.T) {
	store := testStore(t)
	handler := NewManager(store, func(*http.Request) bool { return false }, nil, "/pero/", "")
	server := httptest.NewServer(handler)
	defer server.Close()
	resp, err := http.Post(server.URL+"/drop/api/upload", "multipart/form-data; boundary=x", strings.NewReader(""))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", resp.StatusCode)
	}
}

func TestFileNotFoundAndTraversal(t *testing.T) {
	store := testStore(t)
	src := t.TempDir()
	writeFile(t, filepath.Join(src, "index.html"), "ok")
	entry, err := store.PublishPath(src, "app", PublishOptions{Public: true})
	if err != nil {
		t.Fatal(err)
	}
	server := testDropServer(t, store, nil)
	for _, target := range []string{
		"/d/" + entry.Slug + "/nope.js",
		"/d/" + entry.Slug + "/%2e%2e/entry.json",
	} {
		resp, err := http.Get(server.URL + target)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("%s status = %d, want 404", target, resp.StatusCode)
		}
	}
	if _, err := os.Stat(filepath.Join(store.Root(), entry.ID, MetaName)); err != nil {
		t.Fatal(err)
	}
}
