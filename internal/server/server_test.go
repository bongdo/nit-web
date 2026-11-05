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

func TestPromptFiles(t *testing.T) {
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
		if body.Text != "look" || len(body.Files) != 1 || body.Files[0].URI != "file:///tmp/a.png" {
			t.Errorf("body = %+v", body)
		}
		fmt.Fprint(w, `{"data":{"id":"msg_1"}}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:7788/api/sessions/ses_1/prompt",
		strings.NewReader(`{"text":"look","files":[{"uri":"file:///tmp/a.png","name":"a.png"}]}`))
	req.Header.Set("Content-Type", "application/json")
	newHandler(t, upstream.URL).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
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
