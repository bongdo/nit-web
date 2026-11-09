package drop

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testHandler(t *testing.T, store *Store) *httptest.Server {
	t.Helper()
	handler := NewHandler(store, func(*http.Request) bool { return true }, nil, Nav{
		Nit:  "/nit/",
		Pero: "/pero/",
		Term: "/term/",
		Drop: "/drop/",
	})
	server := httptest.NewServer(handler)
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
	server := testHandler(t, store)
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
		if target == "/drop/" && !strings.Contains(string(body), "Временный буфер") {
			t.Fatal("index has no upload panel")
		}
	}
}

func TestDocsRedirectAndReaderLinks(t *testing.T) {
	store := testStore(t)
	src := t.TempDir()
	writeFile(t, filepath.Join(src, "index.md"), "[other](other.md)")
	writeFile(t, filepath.Join(src, "other.md"), "# other")
	entry, err := store.PublishPath(src, "docs", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	server := testHandler(t, store)
	client := noRedirectClient()

	resp, err := client.Get(server.URL + "/drop/e/" + entry.ID + "/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusSeeOther || !strings.HasSuffix(resp.Header.Get("Location"), "?file=index.md") {
		t.Fatalf("redirect = %d %q", resp.StatusCode, resp.Header.Get("Location"))
	}

	resp, err = client.Get(server.URL + "/drop/e/" + entry.ID + "/?file=index.md")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), `href="?file=other.md"`) {
		t.Fatalf("reader status = %d, body = %s", resp.StatusCode, body)
	}
}

func TestAppIsSandboxed(t *testing.T) {
	store := testStore(t)
	src := t.TempDir()
	writeFile(t, filepath.Join(src, "index.html"), "<!doctype html><h1>app</h1>")
	entry, err := store.PublishPath(src, "app", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	server := testHandler(t, store)
	resp, err := http.Get(server.URL + "/drop/files/" + entry.ID + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if !strings.Contains(resp.Header.Get("Content-Security-Policy"), "sandbox") {
		t.Fatal("app response has no sandbox CSP")
	}
	if resp.Header.Get("X-Frame-Options") != "SAMEORIGIN" {
		t.Fatalf("X-Frame-Options = %q", resp.Header.Get("X-Frame-Options"))
	}
}

func TestUploadAndDelete(t *testing.T) {
	store := testStore(t)
	server := testHandler(t, store)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("ttl", "1h"); err != nil {
		t.Fatal(err)
	}
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
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || created.ID == "" {
		t.Fatalf("upload status = %d, id = %q", resp.StatusCode, created.ID)
	}
	entry, err := store.Get(created.ID)
	if err != nil || entry.Kind != "docs" {
		t.Fatalf("entry = %+v, %v", entry, err)
	}
	payload := strings.NewReader(`{"id":"` + created.ID + `"}`)
	resp, err = http.Post(server.URL+"/drop/api/delete", "application/json", payload)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete status = %d", resp.StatusCode)
	}
	if _, err := store.Get(created.ID); err == nil {
		t.Fatal("entry survived delete")
	}
}

func TestWriteGuard(t *testing.T) {
	store := testStore(t)
	handler := NewHandler(store, func(*http.Request) bool { return false }, nil, Nav{Drop: "/drop/"})
	server := httptest.NewServer(handler)
	defer server.Close()
	resp, err := http.Post(server.URL+"/drop/api/delete", "application/json", strings.NewReader(`{"id":"d-0123456789abcdef"}`))
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
	entry, err := store.PublishPath(src, "app", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	server := testHandler(t, store)
	resp, err := http.Get(server.URL + "/drop/files/" + entry.ID + "/nope.js")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", resp.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(store.Root(), entry.ID, MetaName)); err != nil {
		t.Fatal(err)
	}
}
