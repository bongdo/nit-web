package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type ttsRecorder struct {
	mu      sync.Mutex
	token   string
	clients int
	sayCode int
	texts   []string
	sources []string
	stops   int
}

func newTTSFake(t *testing.T, token string, clients int) (*httptest.Server, *ttsRecorder) {
	t.Helper()
	rec := &ttsRecorder{token: token, clients: clients}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+rec.token {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		switch r.URL.Path {
		case "/health":
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "items": 0, "clients": rec.clients})
		case "/say":
			var body struct {
				Text   string `json:"text"`
				Source string `json:"source"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad body"})
				return
			}
			rec.mu.Lock()
			rec.texts = append(rec.texts, body.Text)
			rec.sources = append(rec.sources, body.Source)
			rec.mu.Unlock()
			if rec.sayCode >= 400 {
				writeJSON(w, rec.sayCode, map[string]string{"error": "nope"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": 1})
		case "/stop":
			rec.mu.Lock()
			rec.stops++
			rec.mu.Unlock()
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server, rec
}

func newTTSFromFake(t *testing.T, url, token string) *ttsHub {
	t.Helper()
	path := filepath.Join(t.TempDir(), "token")
	if token != "" {
		if err := os.WriteFile(path, []byte(token+"\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("NIT_GUI_TTS", "")
	t.Setenv("NIT_GUI_TTS_URL", url)
	t.Setenv("NIT_GUI_TTS_TOKEN_FILE", path)
	t.Setenv("NIT_GUI_TTS_TOKEN", "")
	return newTTSHub()
}

func TestTTSStatus(t *testing.T) {
	server, _ := newTTSFake(t, "secret", 2)
	hub := newTTSFromFake(t, server.URL, "secret")
	ok, clients, detail := hub.status(context.Background())
	if !ok || clients != 2 || detail != "" {
		t.Fatalf("status = %v, %d, %q", ok, clients, detail)
	}

	missing := newTTSFromFake(t, server.URL, "")
	if ok, clients, detail := missing.status(context.Background()); ok || clients != 0 ||
		detail != "host TTS token file not found" {
		t.Fatalf("missing token status = %v, %d, %q", ok, clients, detail)
	}

	rejected := newTTSFromFake(t, server.URL, "wrong")
	rejectedOK, _, rejectedDetail := rejected.status(context.Background())
	if rejectedOK || rejectedDetail != "host TTS token rejected" || strings.Contains(rejectedDetail, "wrong") {
		t.Fatalf("rejected status = %v, %q", rejectedOK, rejectedDetail)
	}

	idleServer, _ := newTTSFake(t, "secret", 0)
	idle := newTTSFromFake(t, idleServer.URL, "secret")
	if ok, clients, detail := idle.status(context.Background()); !ok || clients != 0 || detail != "" {
		t.Fatalf("idle status = %v, %d, %q", ok, clients, detail)
	}

	t.Setenv("NIT_GUI_TTS", "off")
	t.Setenv("NIT_GUI_TTS_URL", server.URL)
	off := newTTSHub()
	if ok, clients, detail := off.status(context.Background()); ok || clients != 0 ||
		detail != "host TTS disabled" {
		t.Fatalf("disabled status = %v, %d, %q", ok, clients, detail)
	}

	closed := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	closedURL := closed.URL
	closed.Close()
	down := newTTSFromFake(t, closedURL, "secret")
	if ok, clients, detail := down.status(context.Background()); ok || clients != 0 ||
		detail != "host TTS not running" {
		t.Fatalf("down status = %v, %d, %q", ok, clients, detail)
	}
}

func TestTTSSay(t *testing.T) {
	server, rec := newTTSFake(t, "secret", 3)
	hub := newTTSFromFake(t, server.URL, "secret")
	clients, err := hub.say(context.Background(), "  hello  ")
	if err != nil {
		t.Fatal(err)
	}
	if clients != 3 {
		t.Fatalf("clients = %d", clients)
	}
	rec.mu.Lock()
	if len(rec.texts) != 1 || rec.texts[0] != "hello" {
		t.Fatalf("texts = %#v", rec.texts)
	}
	if len(rec.sources) != 1 || rec.sources[0] != "nit-gui" {
		t.Fatalf("sources = %#v", rec.sources)
	}
	rec.mu.Unlock()

	if _, err := hub.say(context.Background(), "   "); err == nil || err.Error() != "text is empty" {
		t.Fatalf("empty error = %v", err)
	}
	if _, err := hub.say(context.Background(), strings.Repeat("ж", maxTTSText)); err != nil {
		t.Fatalf("limit text error = %v", err)
	}
	if _, err := hub.say(context.Background(), strings.Repeat("ж", maxTTSText+1)); err == nil {
		t.Fatal("oversized text accepted")
	}

	idleServer, _ := newTTSFake(t, "secret", 0)
	idle := newTTSFromFake(t, idleServer.URL, "secret")
	if _, err := idle.say(context.Background(), "hello"); err == nil || err.Error() != "no audio client" {
		t.Fatalf("idle error = %v", err)
	}

	rejected := newTTSFromFake(t, server.URL, "wrong")
	_, err = rejected.say(context.Background(), "hello")
	if err == nil || err.Error() != "host TTS token rejected" {
		t.Fatalf("rejected error = %v", err)
	}
	if strings.Contains(err.Error(), "wrong") || strings.Contains(err.Error(), "http") {
		t.Fatalf("error leaked connection details: %v", err)
	}

	refusing, refusingRec := newTTSFake(t, "secret", 1)
	refusingRec.sayCode = http.StatusBadRequest
	refuseHub := newTTSFromFake(t, refusing.URL, "secret")
	if _, err := refuseHub.say(context.Background(), "hello"); err == nil ||
		err.Error() != "host TTS rejected the text" {
		t.Fatalf("refused error = %v", err)
	}
}

func TestTTSStop(t *testing.T) {
	server, rec := newTTSFake(t, "secret", 1)
	hub := newTTSFromFake(t, server.URL, "secret")
	if err := hub.stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if rec.stops != 1 {
		t.Fatalf("stops = %d", rec.stops)
	}
}

func TestTTSSpeechCapability(t *testing.T) {
	server, _ := newTTSFake(t, "secret", 2)
	hub := newTTSFromFake(t, server.URL, "secret")
	s := &Server{tts: hub}
	cap := s.speechCapability(context.Background())
	if cap.State != "on" || cap.Owner != "opencode" || cap.Detail != "host TTS · 2 audio client(s)" {
		t.Fatalf("on capability = %#v", cap)
	}

	idleServer, _ := newTTSFake(t, "secret", 0)
	idleHub := newTTSFromFake(t, idleServer.URL, "secret")
	cap = (&Server{tts: idleHub}).speechCapability(context.Background())
	if cap.State != "fallback" || cap.Owner != "browser" || cap.Detail != "host TTS hub up · no audio client" {
		t.Fatalf("fallback capability = %#v", cap)
	}

	t.Setenv("NIT_GUI_TTS", "off")
	offHub := newTTSHub()
	cap = (&Server{tts: offHub}).speechCapability(context.Background())
	if cap.State != "off" || cap.Owner != "opencode" || cap.Detail != "host TTS disabled" {
		t.Fatalf("off capability = %#v", cap)
	}

	cap = (&Server{}).speechCapability(context.Background())
	if cap.State != "off" || cap.Detail != "host TTS not configured" {
		t.Fatalf("nil capability = %#v", cap)
	}
}

func TestTTSHandlers(t *testing.T) {
	server, rec := newTTSFake(t, "secret", 1)
	hub := newTTSFromFake(t, server.URL, "secret")
	s := &Server{tts: hub}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/tts", strings.NewReader(`{"text":"read this"}`))
	s.ttsSay(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var out struct {
		OK      bool `json:"ok"`
		Clients int  `json:"clients"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if !out.OK || out.Clients != 1 {
		t.Fatalf("body = %s", recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/tts", strings.NewReader(`{"text":"   "}`))
	s.ttsSay(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable || !strings.Contains(recorder.Body.String(), "text is empty") {
		t.Fatalf("empty status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/tts",
		strings.NewReader(`{"text":"`+strings.Repeat("x", (64<<10)+1)+`"}`))
	s.ttsSay(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("large status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/tts/stop", nil)
	s.ttsStop(recorder, request)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("stop status = %d", recorder.Code)
	}
	rec.mu.Lock()
	if rec.stops != 1 {
		t.Fatalf("stops = %d", rec.stops)
	}
	rec.mu.Unlock()

	empty := &Server{}
	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/tts", strings.NewReader(`{"text":"hello"}`))
	empty.ttsSay(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable ||
		!strings.Contains(recorder.Body.String(), "host TTS not configured") {
		t.Fatalf("nil status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}
