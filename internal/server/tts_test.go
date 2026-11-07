package server

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
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

const piperScript = `if [ -n "$FAKE_VOICE_STARTS" ]; then printf 'start\n' >> "$FAKE_VOICE_STARTS"; fi
if [ -n "$FAKE_VOICE_ARGS" ]; then printf '%s\n' "$@" > "$FAKE_VOICE_ARGS"; fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-f" ]; then out="$arg"; fi
  prev="$arg"
done
if [ -n "$out" ] && [ "$out" != "-" ]; then
  printf 'UklGRioAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQYAAAByYXdwY20=' | base64 -d > "$out"
  exit 0
fi
while IFS= read -r line; do
  out="$(printf '%s' "$line" | sed -n 's/.*"output_file":"\([^"]*\)".*/\1/p')"
  [ -n "$out" ] || continue
  printf 'UklGRioAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQYAAAByYXdwY20=' | base64 -d > "$out"
done
`

func fakeVoiceScript(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "fake-voice.sh")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func voiceEnv(t *testing.T) {
	t.Helper()
	t.Setenv("NIT_GUI_TTS", "")
	t.Setenv("NIT_GUI_TTS_ENGINE", "off")
	t.Setenv("NIT_GUI_TTS_RATE", "")
	t.Setenv("NIT_GUI_TTS_PIPER", "")
	t.Setenv("NIT_GUI_TTS_PIPER_MODEL", "")
}

func fakePiperVoice(t *testing.T) *hostVoice {
	t.Helper()
	voiceEnv(t)
	model := filepath.Join(t.TempDir(), "voice.onnx")
	if err := os.WriteFile(model, []byte("model"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("NIT_GUI_TTS_ENGINE", "piper")
	t.Setenv("NIT_GUI_TTS_PIPER", fakeVoiceScript(t, piperScript))
	t.Setenv("NIT_GUI_TTS_PIPER_MODEL", model)
	voice := newHostVoice()
	if voice.worker != nil {
		t.Cleanup(voice.worker.stop)
	}
	return voice
}

func TestNewHostVoiceSelection(t *testing.T) {
	piper := fakeVoiceScript(t, piperScript)
	model := filepath.Join(t.TempDir(), "voice.onnx")
	if err := os.WriteFile(model, []byte("model"), 0o600); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(t.TempDir(), "missing")

	cases := []struct {
		name    string
		engine  string
		piper   string
		model   string
		content string
		detail  string
	}{
		{"auto prefers piper", "auto", piper, model, "audio/wav", "host voice · piper"},
		{"auto none", "auto", missing, missing, "", ""},
		{"forced piper", "piper", piper, model, "audio/wav", "host voice · piper"},
		{"edge is gone", "edge", piper, model, "", ""},
		{"off", "off", piper, model, "", ""},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			voiceEnv(t)
			t.Setenv("NIT_GUI_TTS_ENGINE", item.engine)
			t.Setenv("NIT_GUI_TTS_PIPER", item.piper)
			t.Setenv("NIT_GUI_TTS_PIPER_MODEL", item.model)
			voice := newHostVoice()
			if voice.contentType != item.content || voice.detail != item.detail {
				t.Fatalf("voice = %q, %q", voice.contentType, voice.detail)
			}
		})
	}
}

func TestHostVoiceSynthesizePiper(t *testing.T) {
	args := filepath.Join(t.TempDir(), "args")
	t.Setenv("FAKE_VOICE_ARGS", args)
	voice := fakePiperVoice(t)
	t.Setenv("NIT_GUI_TTS_RATE", "2")
	voice = newHostVoice()
	data, contentType, err := voice.synthesize(context.Background(), "  привет  ")
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "audio/wav" || !strings.HasPrefix(string(data), "RIFF") {
		t.Fatalf("contentType = %q, data = %q", contentType, data)
	}
	raw, err := os.ReadFile(args)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "--length_scale") || !strings.Contains(string(raw), "0.5") {
		t.Fatalf("piper args = %q", raw)
	}
}

func TestPiperWorkerStaysWarm(t *testing.T) {
	starts := filepath.Join(t.TempDir(), "starts")
	voice := fakePiperVoice(t)
	t.Setenv("FAKE_VOICE_STARTS", starts)
	for _, text := range []string{"первый", "второй"} {
		if _, _, err := voice.synthesize(context.Background(), text); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(starts)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(raw), "start") != 1 {
		t.Fatalf("piper started %d times, want 1", strings.Count(string(raw), "start"))
	}
}

func TestHostVoiceErrors(t *testing.T) {
	voiceEnv(t)
	model := filepath.Join(t.TempDir(), "voice.onnx")
	if err := os.WriteFile(model, []byte("model"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("NIT_GUI_TTS_ENGINE", "piper")
	t.Setenv("NIT_GUI_TTS_PIPER", fakeVoiceScript(t, "exit 1\n"))
	t.Setenv("NIT_GUI_TTS_PIPER_MODEL", model)
	voice := newHostVoice()
	_, _, err := voice.synthesize(context.Background(), "secret zz top")
	if err == nil || strings.Contains(err.Error(), "secret") {
		t.Fatalf("error = %v", err)
	}

	t.Setenv("NIT_GUI_TTS_PIPER_MODEL", filepath.Join(t.TempDir(), "missing.onnx"))
	missing := newHostVoice()
	if missing.available() {
		t.Fatal("piper available without a model")
	}
	if _, _, err := missing.synthesize(context.Background(), "hello"); err == nil ||
		err.Error() != "host voice is not available" {
		t.Fatalf("missing model error = %v", err)
	}

	empty := newHostVoice()
	if _, _, err := empty.synthesize(context.Background(), "  "); err == nil ||
		err.Error() != "text is empty" {
		t.Fatalf("empty error = %v", err)
	}
	if _, _, err := empty.synthesize(context.Background(), strings.Repeat("ж", maxTTSText+1)); !errors.Is(err, errTTSTextLong) {
		t.Fatalf("long error = %v", err)
	}
}

func TestTTSSpeechCapabilityPrecedence(t *testing.T) {
	voice := fakePiperVoice(t)

	busyServer, _ := newTTSFake(t, "secret", 2)
	busy := newTTSFromFake(t, busyServer.URL, "secret")
	cap := (&Server{tts: busy, voice: voice}).speechCapability(context.Background())
	if cap.State != "on" || cap.Owner != "opencode" || cap.Detail != "host TTS · 2 audio client(s)" {
		t.Fatalf("busy capability = %#v", cap)
	}

	idleServer, _ := newTTSFake(t, "secret", 0)
	idle := newTTSFromFake(t, idleServer.URL, "secret")
	cap = (&Server{tts: idle, voice: voice}).speechCapability(context.Background())
	if cap.State != "on" || cap.Owner != "nit-gui" || cap.Detail != "host voice · piper" {
		t.Fatalf("voice with idle hub capability = %#v", cap)
	}

	closed := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	closedURL := closed.URL
	closed.Close()
	down := newTTSFromFake(t, closedURL, "secret")
	cap = (&Server{tts: down, voice: voice}).speechCapability(context.Background())
	if cap.State != "on" || cap.Owner != "nit-gui" || cap.Detail != "host voice · piper" {
		t.Fatalf("voice with down hub capability = %#v", cap)
	}

	t.Setenv("NIT_GUI_TTS_ENGINE", "off")
	noVoice := newHostVoice()
	cap = (&Server{tts: idle, voice: noVoice}).speechCapability(context.Background())
	if cap.State != "fallback" || cap.Owner != "browser" || cap.Detail != "host TTS hub up · no audio client" {
		t.Fatalf("idle without voice capability = %#v", cap)
	}
	cap = (&Server{tts: down, voice: noVoice}).speechCapability(context.Background())
	if cap.State != "off" || cap.Owner != "opencode" || cap.Detail != "host TTS not running" {
		t.Fatalf("down without voice capability = %#v", cap)
	}
}

func TestTTSStreamHandler(t *testing.T) {
	server := &Server{voice: fakePiperVoice(t), log: slog.Default()}

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/tts/stream", strings.NewReader(`{"text":"привет"}`))
	server.ttsStream(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "audio/L16" {
		t.Fatalf("content type = %q", got)
	}
	if got := recorder.Header().Get("X-Audio-Rate"); got != "22050" {
		t.Fatalf("rate = %q", got)
	}
	if got := recorder.Body.String(); got != "rawpcm" {
		t.Fatalf("body = %q", got)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/tts/stream", strings.NewReader(`{"text":"  "}`))
	server.ttsStream(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("empty status = %d", recorder.Code)
	}

	silent := &Server{voice: &hostVoice{engine: "piper"}, log: slog.Default()}
	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/tts/stream", strings.NewReader(`{"text":"hello"}`))
	silent.ttsStream(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("silent status = %d", recorder.Code)
	}
}

func TestTTSAudioHandler(t *testing.T) {
	s := &Server{voice: fakePiperVoice(t)}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/tts/audio", strings.NewReader(`{"text":"привет"}`))
	s.ttsAudio(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "audio/wav" {
		t.Fatalf("content type = %q", got)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("cache control = %q", got)
	}
	if !strings.HasPrefix(recorder.Body.String(), "RIFF") {
		t.Fatalf("body = %q", recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/tts/audio", strings.NewReader(`{"text":"  "}`))
	s.ttsAudio(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("empty status = %d", recorder.Code)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/tts/audio",
		strings.NewReader(`{"text":"`+strings.Repeat("ж", maxTTSText+1)+`"}`))
	s.ttsAudio(recorder, request)
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("long status = %d", recorder.Code)
	}

	nilVoice := &Server{}
	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/tts/audio", strings.NewReader(`{"text":"hello"}`))
	nilVoice.ttsAudio(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable ||
		!strings.Contains(recorder.Body.String(), "host voice not configured") {
		t.Fatalf("nil status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	voiceEnv(t)
	t.Setenv("NIT_GUI_TTS_ENGINE", "off")
	t.Setenv("NIT_GUI_TTS_TOKEN", "supersecret")
	disabled := &Server{voice: newHostVoice()}
	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/api/tts/audio", strings.NewReader(`{"text":"hello"}`))
	disabled.ttsAudio(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("disabled status = %d", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), "supersecret") {
		t.Fatalf("body leaked the token: %s", recorder.Body.String())
	}
}
