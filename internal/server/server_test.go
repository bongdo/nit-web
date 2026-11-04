package server_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"

	"nitgui/internal/opencode"
	"nitgui/internal/server"
)

const testPassword = "test-password-value"

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
