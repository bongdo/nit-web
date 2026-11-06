package server_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"nitgui/internal/opencode"
	"nitgui/internal/server"
)

const testPassword = "test-password-value"

func basicAuthValue() string { return "opencode:" + testPassword }

func encodedBasicAuthValue() string {
	return base64.StdEncoding.EncodeToString([]byte(basicAuthValue()))
}

func assertNoSecret(t *testing.T, body, where string) {
	t.Helper()
	for _, secret := range []string{testPassword, basicAuthValue(), encodedBasicAuthValue()} {
		if strings.Contains(body, secret) {
			t.Fatalf("%s leaked %q: %s", where, secret, body)
		}
	}
}

type staticProvider struct {
	client *opencode.Client
}

func (p *staticProvider) Client(context.Context) (*opencode.Client, error) { return p.client, nil }
func (p *staticProvider) Drop()                                            {}

func newHandler(t *testing.T, upstreamURL string) http.Handler {
	t.Helper()
	client := opencode.New(opencode.Endpoint{URL: upstreamURL, Password: testPassword})
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return server.New(&staticProvider{client: client}, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html>nit</html>")},
	}, log)
}

func auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, p, ok := r.BasicAuth()
		if !ok || u != "opencode" || p != testPassword {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func TestHealth(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/info" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		fmt.Fprint(w, `{"version":"2.2.5"}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/health", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["ok"] != true || body["version"] != "2.2.5" {
		t.Fatalf("unexpected health body: %s", rec.Body)
	}
	if strings.Contains(rec.Body.String(), testPassword) {
		t.Fatal("health leaked the service password")
	}
}

func TestSessionsProxy(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("limit") != "100" || q.Get("order") != "desc" || q.Get("parentID") != "null" {
			t.Errorf("unexpected query: %s", r.URL.RawQuery)
		}
		if q.Get("directory") != "/home/ubuntu" {
			t.Errorf("directory = %q", q.Get("directory"))
		}
		fmt.Fprint(w, `{"data":[{"id":"ses_1","title":"Hello","location":{"directory":"/home/ubuntu"}}]}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions?dir=/home/ubuntu", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), `"id":"ses_1"`) {
		t.Fatalf("unexpected body: %s", rec.Body)
	}
}

func TestSessionProxy(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/session/ses_child" {
			t.Errorf("path = %s", r.URL.Path)
		}
		fmt.Fprint(w, `{"data":{"id":"ses_child","parentID":"ses_1"}}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions/ses_child", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "ses_child") {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
}

func TestSessionsChildren(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Has("parentID") {
			t.Errorf("children request must not filter parentID: %s", r.URL.RawQuery)
		}
		fmt.Fprint(w, `{"data":[{"id":"ses_child","parentID":"ses_1"}]}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions?children=true", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), `"parentID":"ses_1"`) {
		t.Fatalf("unexpected body: %s", rec.Body)
	}
}

func TestChildrenProxy(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("parentID") != "ses_parent" {
			t.Errorf("parentID = %q", r.URL.Query().Get("parentID"))
		}
		fmt.Fprint(w, `{"data":[{"id":"ses_child","parentID":"ses_parent"}]}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions/ses_parent/children", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "ses_child") {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
}

func TestUploadProxy(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/experimental/fs/write" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if r.URL.Query().Get("location[directory]") != "/home/ubuntu" {
			t.Errorf("directory = %q", r.URL.Query().Get("location[directory]"))
		}
		if !strings.Contains(r.URL.Query().Get("path"), "shot.png") {
			t.Errorf("path = %q", r.URL.Query().Get("path"))
		}
		body, _ := io.ReadAll(r.Body)
		if string(body) != "hello" {
			t.Errorf("body = %q", body)
		}
		fmt.Fprint(w, `{"data":{"path":"/tmp/saved-shot.png"}}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost,
		"http://127.0.0.1:7788/api/upload?dir=/home/ubuntu&name=shot.png",
		strings.NewReader("hello"))
	newHandler(t, upstream.URL).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "/tmp/saved-shot.png") {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
}

func TestUploadSanitizesPathButKeepsDisplayName(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Query().Get("path")
		if strings.ContainsAny(filepath.Base(path), " #?%") {
			t.Errorf("path is not URL-safe: %q", path)
		}
		fmt.Fprintf(w, `{"data":{"path":%q}}`, path)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost,
		"http://127.0.0.1:7788/api/upload?dir=/home/ubuntu&name=a%20b%23c%3F.pdf",
		strings.NewReader("hello"))
	newHandler(t, upstream.URL).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	var body struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(body.Path, "-a_b_c.pdf") {
		t.Fatalf("path = %q", body.Path)
	}
	if body.Name != "a b#c?.pdf" {
		t.Fatalf("name = %q", body.Name)
	}
}

func TestPromptFiles(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Text     string `json:"text"`
			Delivery string `json:"delivery"`
			Files    []struct {
				URI string `json:"uri"`
			} `json:"files"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Text != "look" || body.Delivery != "queue" ||
			len(body.Files) != 1 || body.Files[0].URI != "file:///tmp/a.png" {
			t.Errorf("body = %+v", body)
		}
		fmt.Fprint(w, `{"data":{"id":"msg_1"}}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7788/api/sessions/ses_1/prompt",
		strings.NewReader(`{"text":"look","delivery":"queue","files":[{"uri":"file:///tmp/a.png","name":"a.png"}]}`))
	req.Header.Set("Content-Type", "application/json")
	newHandler(t, upstream.URL).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
}

func TestPromptAllowsFilesWithoutText(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Text  string `json:"text"`
			Files []struct {
				URI string `json:"uri"`
			} `json:"files"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Text != "" || len(body.Files) != 1 {
			t.Errorf("body = %+v", body)
		}
		fmt.Fprint(w, `{"data":{"id":"msg_1"}}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7788/api/sessions/ses_1/prompt",
		strings.NewReader(`{"text":"","files":[{"uri":"file:///tmp/a.png","name":"a.png"}]}`))
	req.Header.Set("Content-Type", "application/json")
	newHandler(t, upstream.URL).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
}

func TestPromptRequiresTextOrFiles(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7788/api/sessions/ses_1/prompt",
		strings.NewReader(`{"text":"  "}`))
	req.Header.Set("Content-Type", "application/json")
	newHandler(t, "http://127.0.0.1:1").ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
}

func TestRevertStagesAndCommits(t *testing.T) {
	var calls []string
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.Path)
		if strings.HasSuffix(r.URL.Path, "/stage") {
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["files"] != false {
				t.Errorf("stage must not revert files: %+v", body)
			}
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7788/api/sessions/ses_1/revert",
		strings.NewReader(`{"messageID":"msg_1"}`))
	req.Header.Set("Content-Type", "application/json")
	newHandler(t, upstream.URL).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	want := []string{"/api/session/ses_1/revert/stage", "/api/session/ses_1/revert/commit"}
	if fmt.Sprint(calls) != fmt.Sprint(want) {
		t.Fatalf("calls = %v", calls)
	}
}

func TestFormReply(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/session/ses_1/form/frm_1/reply" {
			t.Errorf("path = %s", r.URL.Path)
		}
		var body struct {
			Answer map[string]any `json:"answer"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Answer["q0"] != "yes" {
			t.Errorf("answer = %+v", body.Answer)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost,
		"http://127.0.0.1:7788/api/sessions/ses_1/form/frm_1/reply",
		strings.NewReader(`{"answer":{"q0":"yes"}}`))
	req.Header.Set("Content-Type", "application/json")
	newHandler(t, upstream.URL).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
}

func TestFileProxy(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/fs/read/tmp/nit-gui-1-shot.png" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if r.URL.Query().Get("location[directory]") != "/" {
			t.Errorf("location = %q", r.URL.Query().Get("location[directory]"))
		}
		fmt.Fprint(w, "PNG")
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"http://127.0.0.1:7788/api/file?path=file:///tmp/nit-gui-1-shot.png", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "PNG" {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("content type = %q", rec.Header().Get("Content-Type"))
	}
}

func TestFileProxyRejectsTraversal(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"http://127.0.0.1:7788/api/file?path=file:///tmp/nit-gui-../../etc/passwd", nil)
	newHandler(t, "http://127.0.0.1:1").ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
}

func TestFileProxyAllowsFrameForPDFPreview(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/fs/read/tmp/nit-gui-1-a%20b.pdf" && r.URL.Path != "/api/fs/read/tmp/nit-gui-1-a b.pdf" {
			t.Errorf("path = %q", r.URL.Path)
		}
		fmt.Fprint(w, "%PDF")
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"http://127.0.0.1:7788/api/file?path=file:///tmp/nit-gui-1-a%20b.pdf", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if rec.Header().Get("X-Frame-Options") != "SAMEORIGIN" {
		t.Fatalf("x-frame-options = %q", rec.Header().Get("X-Frame-Options"))
	}
}

func TestFileProxyDownloadsActiveContent(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "<script>alert(1)</script>")
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"http://127.0.0.1:7788/api/file?path=file:///tmp/nit-gui-1-page.html", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if !strings.HasPrefix(rec.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("content disposition = %q", rec.Header().Get("Content-Disposition"))
	}
	if rec.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("x-frame-options = %q", rec.Header().Get("X-Frame-Options"))
	}
}

func TestSTT(t *testing.T) {
	script := filepath.Join(t.TempDir(), "whisper")
	if err := os.WriteFile(script, []byte("#!/bin/sh\necho hello world\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("NIT_GUI_WHISPER", script)
	t.Setenv("NIT_GUI_WHISPER_MODEL", script)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7788/api/stt", strings.NewReader("RIFF"))
	newHandler(t, "http://127.0.0.1:1").ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "hello world") {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
}

func TestProjectsProxy(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/project" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		fmt.Fprint(w, `[{"id":"p1","canonical":"/home/ubuntu/Projects/nit-gui","vcs":"git"}]`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/projects", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), `"canonical":"/home/ubuntu/Projects/nit-gui"`) {
		t.Fatalf("unexpected body: %s", rec.Body)
	}
}

func TestDeleteSession(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/api/session/ses_1" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "http://127.0.0.1:7788/api/sessions/ses_1", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
}

func TestMessagesPaginate(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("cursor") {
		case "":
			if r.URL.Query().Get("order") != "asc" {
				t.Errorf("first page order = %q", r.URL.Query().Get("order"))
			}
			fmt.Fprint(w, `{"data":[{"id":"m1"}],"cursor":{"next":"abc"}}`)
		case "abc":
			if r.URL.Query().Get("order") != "" {
				t.Errorf("cursor page must not combine order")
			}
			fmt.Fprint(w, `{"data":[{"id":"m2"}],"cursor":{"next":null}}`)
		default:
			t.Errorf("unexpected cursor")
		}
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions/ses_1/messages", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	var body struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data) != 2 || body.Data[0]["id"] != "m1" || body.Data[1]["id"] != "m2" {
		t.Fatalf("unexpected data: %s", rec.Body)
	}
}

func TestMessagesLimit(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		switch query.Get("cursor") {
		case "":
			if query.Get("order") != "desc" || query.Get("limit") != "2" {
				t.Errorf("unexpected first page query: %s", r.URL.RawQuery)
			}
			fmt.Fprint(w, `{"data":[{"id":"m3"},{"id":"m2"}],"cursor":{"next":"older","previous":"newer"}}`)
		case "older":
			if query.Get("order") != "" || query.Get("limit") != "2" {
				t.Errorf("unexpected older page query: %s", r.URL.RawQuery)
			}
			fmt.Fprint(w, `{"data":[{"id":"m1"}],"cursor":{"next":null,"previous":"newer"}}`)
		default:
			t.Errorf("unexpected cursor %q", query.Get("cursor"))
		}
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions/ses_1/messages?limit=2", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	var body struct {
		Data     []map[string]any `json:"data"`
		Previous *string          `json:"previous"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data) != 2 || body.Data[0]["id"] != "m2" || body.Data[1]["id"] != "m3" {
		t.Fatalf("tail not reversed: %s", rec.Body)
	}
	if body.Previous == nil || *body.Previous != "older" {
		t.Fatalf("previous = %v: %s", body.Previous, rec.Body)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions/ses_1/messages?limit=2&before=older", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	body = struct {
		Data     []map[string]any `json:"data"`
		Previous *string          `json:"previous"`
	}{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data) != 1 || body.Data[0]["id"] != "m1" || body.Previous != nil {
		t.Fatalf("unexpected older page: %s", rec.Body)
	}
}

func TestMessagesLight(t *testing.T) {
	reasoning := strings.Repeat("r", 300)
	answer := strings.Repeat("a", 300)
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"data":[
			{"id":"m1","type":"user","time":{"created":1},"text":"hello"},
			{"id":"m2","type":"assistant","time":{"created":2},"content":[
				{"type":"reasoning","text":%q,"ordinal":0},
				{"type":"tool","id":"t1","name":"read","state":{"status":"completed","input":{"filePath":"/tmp/a"},"content":[{"type":"text","text":"tool output"}],"metadata":{"lines":3}}},
				{"type":"tool","id":"t2","name":"bash","state":{"status":"error","input":{"command":"false"},"error":{"message":"boom"}}},
				{"type":"tool","id":"q1","name":"question","state":{"status":"completed","input":{"questions":[{"question":"Pick","options":[{"label":"A"}]}]},"content":[{"type":"text","text":"User answered: A"}],"metadata":{"answers":[["A"]]}}},
				{"type":"text","text":%q,"ordinal":0}
			]},
			{"id":"m3","type":"compaction","time":{"created":3},"summary":"kept summary"}
		],"cursor":{"next":null}}`, reasoning, answer)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions/ses_1/messages?light=1", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	var body struct {
		Data []struct {
			ID      string `json:"id"`
			Type    string `json:"type"`
			Text    string `json:"text"`
			Summary string `json:"summary"`
			Steps   int    `json:"steps"`
			Tools   int    `json:"tools"`
			Errors  int    `json:"errors"`
			Content []struct {
				Type  string         `json:"type"`
				Text  string         `json:"text"`
				Light bool           `json:"light"`
				State map[string]any `json:"state"`
			} `json:"content"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data) != 3 {
		t.Fatalf("messages = %d: %s", len(body.Data), rec.Body)
	}
	if body.Data[0].Text != "hello" || body.Data[2].Summary != "kept summary" {
		t.Fatalf("user or compaction changed: %s", rec.Body)
	}
	if body.Data[1].Steps != 3 || body.Data[1].Tools != 2 || body.Data[1].Errors != 1 {
		t.Fatalf("step counts = %+v: %s", body.Data[1], rec.Body)
	}
	parts := body.Data[1].Content
	if len(parts) != 2 {
		t.Fatalf("parts = %d: %s", len(parts), rec.Body)
	}
	if parts[0].Type != "tool" || parts[0].Light {
		t.Fatalf("question marked light: %+v", parts[0])
	}
	for _, key := range []string{"input", "content", "metadata"} {
		if _, ok := parts[0].State[key]; !ok {
			t.Fatalf("question lost %s: %+v", key, parts[0].State)
		}
	}
	if parts[1].Type != "text" || len(parts[1].Text) != 300 {
		t.Fatalf("answer changed: %+v", parts[1])
	}
}

const (
	lightAnsweredQuestion = `{"type":"tool","id":"q1","name":"question","executed":true,"time":{"created":10,"ran":11,"completed":20},"state":{"status":"completed","input":{"questions":[{"header":"Pick","question":"Pick one","options":[{"label":"A","description":"first"}]}]},"content":[{"type":"text","text":"User answered: A"}],"metadata":{"answers":[["A"]]}}}`
	lightPendingQuestion  = `{"type":"tool","id":"q2","name":"question","executed":false,"time":{"created":11},"state":{"status":"running","input":{"questions":[{"question":"Waiting"}]}}}`
	lightErroredQuestion  = `{"type":"tool","id":"q3","name":"question","executed":false,"time":{"created":12},"state":{"status":"error","input":{"questions":[{"question":"Boom"}]},"error":{"name":"ToolError","message":"timed out"}}}`
	lightReadPart         = `{"type":"tool","id":"t1","name":"read","executed":true,"time":{"created":5},"state":{"status":"completed","input":{"filePath":"/tmp/a"},"content":[{"type":"text","text":"tool output"}],"metadata":{"lines":3}}}`
	lightReasoningPart    = `{"type":"reasoning","id":"r1","time":{"created":4},"text":"thinking hard","ordinal":0}`
)

func lightQuestionFixtures(t *testing.T) map[string]map[string]any {
	t.Helper()
	originals := map[string]map[string]any{}
	for _, raw := range []string{lightAnsweredQuestion, lightPendingQuestion, lightErroredQuestion} {
		var part map[string]any
		if err := json.Unmarshal([]byte(raw), &part); err != nil {
			t.Fatal(err)
		}
		originals[part["id"].(string)] = part
	}
	return originals
}

func decodeLightPage(t *testing.T, rec *httptest.ResponseRecorder) ([]string, map[string]map[string]any, *string) {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	var body struct {
		Data []struct {
			ID      string           `json:"id"`
			Content []map[string]any `json:"content"`
		} `json:"data"`
		Previous *string `json:"previous"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	ids := make([]string, len(body.Data))
	parts := map[string]map[string]any{}
	for index, message := range body.Data {
		ids[index] = message.ID
		for _, part := range message.Content {
			if id, _ := part["id"].(string); id != "" {
				parts[id] = part
			}
		}
	}
	return ids, parts, body.Previous
}

func assertQuestionUnchanged(t *testing.T, parts map[string]map[string]any, original map[string]any) {
	t.Helper()
	id := original["id"].(string)
	part, ok := parts[id]
	if !ok {
		t.Fatalf("question %s missing", id)
	}
	if _, ok := part["light"]; ok {
		t.Fatalf("question %s was marked light: %v", id, part)
	}
	if !reflect.DeepEqual(part, original) {
		t.Fatalf("question %s changed:\n got %v\nwant %v", id, part, original)
	}
}

func assertStrippedTool(t *testing.T, parts map[string]map[string]any, id string) {
	t.Helper()
	if part, ok := parts[id]; ok {
		t.Fatalf("tool %s survived: %v", id, part)
	}
}

func TestMessagesLightKeepsQuestions(t *testing.T) {
	originals := lightQuestionFixtures(t)
	cases := []struct {
		name      string
		content   string
		questions []string
		stripped  []string
		reasoning bool
	}{
		{
			name:      "answered",
			content:   "[" + lightAnsweredQuestion + "]",
			questions: []string{"q1"},
		},
		{
			name:      "pending",
			content:   "[" + lightPendingQuestion + "]",
			questions: []string{"q2"},
		},
		{
			name:      "errored",
			content:   "[" + lightErroredQuestion + "]",
			questions: []string{"q3"},
		},
		{
			name:      "mixed with stripped parts",
			content:   "[" + lightReasoningPart + "," + lightReadPart + "," + lightAnsweredQuestion + "," + lightPendingQuestion + "]",
			questions: []string{"q1", "q2"},
			stripped:  []string{"t1"},
			reasoning: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprintf(w, `{"data":[{"id":"m1","type":"assistant","time":{"created":1},"content":%s}],"cursor":{"next":null}}`, tc.content)
			}))
			defer upstream.Close()

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions/ses_1/messages?light=1", nil)
			newHandler(t, upstream.URL).ServeHTTP(rec, req)
			_, parts, _ := decodeLightPage(t, rec)

			for _, id := range tc.questions {
				assertQuestionUnchanged(t, parts, originals[id])
			}
			for _, id := range tc.stripped {
				assertStrippedTool(t, parts, id)
			}
			if tc.reasoning {
				if part, ok := parts["r1"]; ok {
					t.Fatalf("reasoning survived: %v", part)
				}
				var body struct {
					Data []struct {
						Steps  int `json:"steps"`
						Tools  int `json:"tools"`
						Errors int `json:"errors"`
					} `json:"data"`
				}
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if len(body.Data) != 1 || body.Data[0].Steps != 2 || body.Data[0].Tools != 1 {
					t.Fatalf("step counts = %+v: %s", body.Data, rec.Body)
				}
			}
		})
	}
}

func TestMessagesLightLimitKeepsQuestions(t *testing.T) {
	originals := lightQuestionFixtures(t)
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		switch query.Get("cursor") {
		case "":
			if query.Get("order") != "desc" || query.Get("limit") != "2" {
				t.Errorf("unexpected first page query: %s", r.URL.RawQuery)
			}
			fmt.Fprintf(w, `{"data":[
				{"id":"m3","type":"assistant","time":{"created":3},"content":[%s,%s]},
				{"id":"m2","type":"user","time":{"created":2},"text":"hello"}
			],"cursor":{"next":"older"}}`, lightAnsweredQuestion, lightReadPart)
		case "older":
			if query.Get("order") != "" || query.Get("limit") != "2" {
				t.Errorf("unexpected older page query: %s", r.URL.RawQuery)
			}
			fmt.Fprintf(w, `{"data":[{"id":"m1","type":"assistant","time":{"created":1},"content":[%s]}],"cursor":{"next":null}}`, lightPendingQuestion)
		default:
			t.Errorf("unexpected cursor %q", query.Get("cursor"))
		}
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions/ses_1/messages?light=1&limit=2", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)
	ids, parts, previous := decodeLightPage(t, rec)
	if len(ids) != 2 || ids[0] != "m2" || ids[1] != "m3" {
		t.Fatalf("tail not reversed: %s", rec.Body)
	}
	if previous == nil || *previous != "older" {
		t.Fatalf("previous = %v: %s", previous, rec.Body)
	}
	assertQuestionUnchanged(t, parts, originals["q1"])
	assertStrippedTool(t, parts, "t1")

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions/ses_1/messages?light=1&limit=2&before=older", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)
	ids, parts, previous = decodeLightPage(t, rec)
	if len(ids) != 1 || ids[0] != "m1" || previous != nil {
		t.Fatalf("unexpected older page: %s", rec.Body)
	}
	assertQuestionUnchanged(t, parts, originals["q2"])
}

func TestMessageProxy(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/session/ses_1/message/msg_1" {
			t.Errorf("path = %s", r.URL.Path)
		}
		fmt.Fprintf(w, `{"data":{"id":"msg_1","type":"assistant","time":{"created":1},"content":[{"type":"text","text":"secret %s"}]}}`, testPassword)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions/ses_1/messages/msg_1", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	assertNoSecret(t, rec.Body.String(), "message")
	var body struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Data.ID != "msg_1" {
		t.Fatalf("unexpected body: %s", rec.Body)
	}
}

func TestPromptForwardsText(t *testing.T) {
	var got string
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got = string(b)
		fmt.Fprint(w, `{"data":{"id":"inbox_1"}}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7788/api/sessions/ses_1/prompt", strings.NewReader(`{"text":"hello"}`))
	req.Header.Set("Content-Type", "application/json")
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if got != `{"text":"hello"}` {
		t.Fatalf("upstream body = %s", got)
	}
}

func TestPromptBodyLimit(t *testing.T) {
	var called atomic.Bool
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		called.Store(true)
		fmt.Fprint(w, `{}`)
	}))
	defer upstream.Close()

	body := `{"text":"` + strings.Repeat("x", 1<<20) + `"}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7788/api/sessions/ses_1/prompt", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413: %s", rec.Code, rec.Body)
	}
	if called.Load() {
		t.Fatal("oversized body reached upstream")
	}
}

func TestUpstreamErrorDoesNotLeakPassword(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprintf(w, `{"_tag":"Boom","message":"upstream failed with %s"}`, testPassword)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7788/api/sessions/ses_1/prompt", strings.NewReader(`{"text":"hello"}`))
	req.Header.Set("Content-Type", "application/json")
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), testPassword) || !strings.Contains(rec.Body.String(), "[redacted]") {
		t.Fatalf("upstream error was not redacted: %s", rec.Body)
	}
}

func TestEventsProxy(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"server.connected\"}\n\n")
	}))
	defer upstream.Close()

	proxy := httptest.NewServer(newHandler(t, upstream.URL))
	defer proxy.Close()

	resp, err := http.Get(proxy.URL + "/api/events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if !strings.Contains(string(body), "server.connected") {
		t.Fatalf("unexpected event body: %s", body)
	}
}

func TestMessagesRedactSecrets(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"data":[{"id":"m1","type":"assistant","time":{"created":1},"content":[{"type":"tool","id":"t1","name":"shell","state":{"status":"completed","content":[{"type":"text","text":"password=%s basic=%s encoded=%s"}]}}]}],"cursor":{"next":null}}`,
			testPassword, basicAuthValue(), encodedBasicAuthValue())
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions/ses_1/messages", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	assertNoSecret(t, rec.Body.String(), "messages")
	if !strings.Contains(rec.Body.String(), "[redacted]") {
		t.Fatalf("messages were not redacted: %s", rec.Body)
	}
	var body struct {
		Data []struct {
			ID      string `json:"id"`
			Content []struct {
				Name  string `json:"name"`
				State struct {
					Content []struct {
						Text string `json:"text"`
					} `json:"content"`
				} `json:"state"`
			} `json:"content"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("transcript is not valid JSON: %v", err)
	}
	if len(body.Data) != 1 || body.Data[0].ID != "m1" || body.Data[0].Content[0].Name != "shell" {
		t.Fatalf("transcript shape changed: %s", rec.Body)
	}
	text := body.Data[0].Content[0].State.Content[0].Text
	if !strings.Contains(text, "password=[redacted]") || !strings.Contains(text, "basic=[redacted]") {
		t.Fatalf("tool output text was not redacted: %q", text)
	}
}

func TestSessionsRedactSecrets(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"data":[{"id":"ses_1","title":"leak %s and %s","location":{"directory":"/home/ubuntu"}}]}`,
			testPassword, encodedBasicAuthValue())
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions?dir=/home/ubuntu", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	assertNoSecret(t, rec.Body.String(), "sessions")
	var body struct {
		Data []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("session list is not valid JSON: %v", err)
	}
	if len(body.Data) != 1 || body.Data[0].ID != "ses_1" || !strings.Contains(body.Data[0].Title, "[redacted]") {
		t.Fatalf("session list shape changed: %s", rec.Body)
	}
}

func TestPromptResponseRedactsSecrets(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"data":{"id":"inbox_1","text":"%s %s"}}`, basicAuthValue(), encodedBasicAuthValue())
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7788/api/sessions/ses_1/prompt", strings.NewReader(`{"text":"hello"}`))
	req.Header.Set("Content-Type", "application/json")
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	assertNoSecret(t, rec.Body.String(), "prompt response")
	var body struct {
		Data struct {
			ID   string `json:"id"`
			Text string `json:"text"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("prompt response is not valid JSON: %v", err)
	}
	if body.Data.ID != "inbox_1" || !strings.Contains(body.Data.Text, "[redacted]") {
		t.Fatalf("prompt response shape changed: %s", rec.Body)
	}
}

func TestEventsRedactSecrets(t *testing.T) {
	payload := fmt.Sprintf(`{"type":"session.tool.success","data":{"text":"%s","basic":"%s","encoded":"%s"}}`,
		testPassword, basicAuthValue(), encodedBasicAuthValue())
	line := "data: " + payload + "\n\n"

	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Error("upstream cannot flush")
			return
		}
		split := strings.Index(line, testPassword) + 10
		fmt.Fprint(w, line[:split])
		flusher.Flush()
		time.Sleep(20 * time.Millisecond)
		fmt.Fprint(w, line[split:])
		flusher.Flush()
	}))
	defer upstream.Close()

	proxy := httptest.NewServer(newHandler(t, upstream.URL))
	defer proxy.Close()

	resp, err := http.Get(proxy.URL + "/api/events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	body := string(raw)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d: %s", resp.StatusCode, body)
	}
	assertNoSecret(t, body, "events")
	if !strings.Contains(body, "[redacted]") {
		t.Fatalf("events were not redacted: %s", body)
	}
	lines := strings.Split(strings.TrimSpace(body), "\n")
	if len(lines) != 1 {
		t.Fatalf("expected one SSE event, got %q", body)
	}
	eventPayload, ok := strings.CutPrefix(lines[0], "data: ")
	if !ok {
		t.Fatalf("SSE framing changed: %q", lines[0])
	}
	var event struct {
		Type string `json:"type"`
		Data struct {
			Text    string `json:"text"`
			Basic   string `json:"basic"`
			Encoded string `json:"encoded"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(eventPayload), &event); err != nil {
		t.Fatalf("SSE data is not valid JSON: %v", err)
	}
	if event.Type != "session.tool.success" || event.Data.Basic != "[redacted]" || event.Data.Encoded != "[redacted]" {
		t.Fatalf("SSE event shape changed: %s", eventPayload)
	}
}

func TestRejectsForeignOrigin(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7788/api/sessions/ses_1/interrupt", nil)
	req.Header.Set("Origin", "http://evil.example")
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestAllowsUppercaseLocalhost(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"version":"2.2.5"}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://LOCALHOST:7788/api/health", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("unexpected body: %s", rec.Body)
	}
}

func TestAllowsConfiguredHost(t *testing.T) {
	t.Setenv("NIT_GUI_ALLOWED_HOSTS", "public.example, 100.64.0.1")
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"version":"2.2.5"}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://public.example:7792/api/health", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body)
	}
}

func TestRejectsUnconfiguredHost(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://evil.example/api/health", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestConfiguredHostAllowsMatchingOrigin(t *testing.T) {
	t.Setenv("NIT_GUI_ALLOWED_HOSTS", "public.example")
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://public.example:7792/api/unknown", nil)
	req.Header.Set("Origin", "http://public.example:7792")
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestConfigDefaults(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/location":
			fmt.Fprint(w, `{"directory":"/home/ubuntu"}`)
		case "/api/model/default":
			fmt.Fprint(w, `{"data":{"id":"m1","providerID":"p1"}}`)
		case "/api/agent":
			fmt.Fprint(w, `{"data":[{"id":"explore","mode":"subagent","hidden":false},{"id":"build","mode":"primary","hidden":false}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/config", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	var body struct {
		Directory string `json:"directory"`
		Agent     string `json:"agent"`
		Model     struct {
			ID         string `json:"id"`
			ProviderID string `json:"providerID"`
		} `json:"model"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Directory != "/home/ubuntu" || body.Agent != "build" || body.Model.ID != "m1" {
		t.Fatalf("unexpected config: %s", rec.Body)
	}
}

func TestModelsExposeInputCapabilities(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"data":[{"id":"m1","providerID":"p1","capabilities":{"input":["text","image","pdf"]}}]}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/models", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"pdf"`) {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
}

func TestStaticFallback(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/some/route", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "nit") {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
}

type multiProvider struct {
	clients map[string]*opencode.Client
	specs   []opencode.InstanceSpec
	def     string
}

func (p *multiProvider) Client(context.Context) (*opencode.Client, error) {
	return p.clients[p.def], nil
}

func (p *multiProvider) Drop() {}

func (p *multiProvider) ClientFor(_ context.Context, name string) (*opencode.Client, error) {
	client, ok := p.clients[name]
	if !ok {
		return nil, opencode.ErrUnknownInstance
	}
	return client, nil
}

func (p *multiProvider) DropFor(string) {}

func (p *multiProvider) Instances() []opencode.InstanceSpec { return p.specs }

func (p *multiProvider) DefaultInstance() string { return p.def }

func (p *multiProvider) ConfigError() string { return "" }

func (p *multiProvider) Connected(string) bool { return true }

func (p *multiProvider) LastError(string) string { return "" }

func (p *multiProvider) Transport(string) string { return "local" }

func (p *multiProvider) Detail(name string) string { return name }

func newMultiHandler(t *testing.T, provider *multiProvider) http.Handler {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return server.New(provider, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html>nit</html>")},
	}, log)
}

func TestInstancesAndRouting(t *testing.T) {
	upstreamA := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"version":"2.4.0"}`)
	}))
	defer upstreamA.Close()
	upstreamB := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"version":"2.3.1"}`)
	}))
	defer upstreamB.Close()

	provider := &multiProvider{
		clients: map[string]*opencode.Client{
			"alpha": opencode.New(opencode.Endpoint{URL: upstreamA.URL, Password: testPassword}),
			"beta":  opencode.New(opencode.Endpoint{URL: upstreamB.URL, Password: testPassword}),
		},
		specs: []opencode.InstanceSpec{
			{Name: "alpha", URL: "auto"},
			{Name: "beta", URL: upstreamB.URL, Dir: "/srv/projects"},
		},
		def: "alpha",
	}
	handler := newMultiHandler(t, provider)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/instances", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("instances status = %d: %s", rec.Code, rec.Body)
	}
	var body struct {
		Default   string `json:"default"`
		Instances []struct {
			ID               string `json:"id"`
			State            string `json:"state"`
			DefaultDirectory string `json:"defaultDirectory"`
			OpenCode         struct {
				Version string `json:"version"`
			} `json:"opencode"`
			Capabilities []struct {
				ID       string `json:"id"`
				State    string `json:"state"`
				Required bool   `json:"required"`
			} `json:"capabilities"`
		} `json:"instances"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Default != "alpha" || len(body.Instances) != 2 {
		t.Fatalf("unexpected instances: %s", rec.Body)
	}
	if body.Instances[0].State != "connected" || body.Instances[0].OpenCode.Version != "2.4.0" {
		t.Fatalf("unexpected alpha: %+v", body.Instances[0])
	}
	if body.Instances[1].OpenCode.Version != "2.3.1" || body.Instances[1].DefaultDirectory != "/srv/projects" {
		t.Fatalf("unexpected beta: %+v", body.Instances[1])
	}
	required := false
	for _, cap := range body.Instances[0].Capabilities {
		if cap.ID == "chat" && cap.Required {
			required = true
		}
	}
	if !required {
		t.Fatalf("chat is not required: %s", rec.Body)
	}
	assertNoSecret(t, rec.Body.String(), "/api/instances")

	health := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/health", nil)
	request.Header.Set("X-Nit-Instance", "beta")
	handler.ServeHTTP(health, request)
	if !strings.Contains(health.Body.String(), `"version":"2.3.1"`) {
		t.Fatalf("health did not route to beta: %s", health.Body)
	}

	unknown := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/health", nil)
	request.Header.Set("X-Nit-Instance", "missing")
	handler.ServeHTTP(unknown, request)
	if unknown.Code != http.StatusBadRequest {
		t.Fatalf("unknown instance health = %d: %s", unknown.Code, unknown.Body)
	}
}
