package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	defaultTTSURL = "http://127.0.0.1:7787"
	maxTTSText    = 20000
	ttsTimeout    = 2 * time.Second
)

var (
	errTTSTextEmpty = errors.New("text is empty")
	errTTSTextLong  = fmt.Errorf("text is longer than %d characters", maxTTSText)
)

func ttsText(text string) (string, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", errTTSTextEmpty
	}
	if utf8.RuneCountInString(text) > maxTTSText {
		return "", errTTSTextLong
	}
	return text, nil
}

type ttsHub struct {
	url       string
	tokenFile string
	token     string
	client    *http.Client
}

func newTTSHub() *ttsHub {
	hub := &ttsHub{client: &http.Client{Timeout: 5 * time.Second}}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("NIT_GUI_TTS")), "off") {
		return hub
	}
	hub.url = strings.TrimRight(strings.TrimSpace(os.Getenv("NIT_GUI_TTS_URL")), "/")
	if hub.url == "" {
		hub.url = defaultTTSURL
	}
	hub.tokenFile = ttsTokenFile()
	hub.token = strings.TrimSpace(os.Getenv("NIT_GUI_TTS_TOKEN"))
	return hub
}

func ttsTokenFile() string {
	path := strings.TrimSpace(os.Getenv("NIT_GUI_TTS_TOKEN_FILE"))
	if path == "" {
		state := strings.TrimSpace(os.Getenv("XDG_STATE_HOME"))
		if state == "" {
			if home, err := os.UserHomeDir(); err == nil {
				state = filepath.Join(home, ".local", "state")
			}
		}
		path = filepath.Join(state, "opencode-tts", "token")
	}
	return expandHome(path)
}

func expandHome(path string) string {
	if path == "~" || strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, strings.TrimPrefix(path, "~"))
		}
	}
	return path
}

func (h *ttsHub) readToken() (string, error) {
	if h.token != "" {
		return h.token, nil
	}
	raw, err := os.ReadFile(h.tokenFile)
	if err != nil {
		return "", err
	}
	token := strings.TrimSpace(string(raw))
	if token == "" {
		return "", os.ErrNotExist
	}
	return token, nil
}

func (h *ttsHub) status(ctx context.Context) (bool, int, string) {
	if h.url == "" {
		return false, 0, "host TTS disabled"
	}
	token, err := h.readToken()
	if err != nil {
		return false, 0, "host TTS token file not found"
	}
	var out struct {
		OK      bool `json:"ok"`
		Clients int  `json:"clients"`
	}
	code, err := h.request(ctx, http.MethodGet, "/health", token, nil, &out)
	if err != nil {
		return false, 0, "host TTS not running"
	}
	if code == http.StatusUnauthorized {
		return false, 0, "host TTS token rejected"
	}
	if code >= 400 || !out.OK {
		return false, 0, "host TTS not ready"
	}
	return true, out.Clients, ""
}

func (h *ttsHub) say(ctx context.Context, text string) (int, error) {
	text, err := ttsText(text)
	if err != nil {
		return 0, err
	}
	ok, clients, detail := h.status(ctx)
	if !ok {
		return 0, errors.New(detail)
	}
	if clients == 0 {
		return 0, errors.New("no audio client")
	}
	token, err := h.readToken()
	if err != nil {
		return 0, errors.New("host TTS token file not found")
	}
	code, err := h.request(ctx, http.MethodPost, "/say", token, map[string]string{
		"text":   text,
		"source": "nit-gui",
	}, nil)
	if err != nil {
		return 0, errors.New("host TTS not running")
	}
	if code >= 400 {
		return 0, errors.New("host TTS rejected the text")
	}
	return clients, nil
}

func (h *ttsHub) stop(ctx context.Context) error {
	if h.url == "" {
		return errors.New("host TTS disabled")
	}
	token, err := h.readToken()
	if err != nil {
		return errors.New("host TTS token file not found")
	}
	code, err := h.request(ctx, http.MethodPost, "/stop", token, map[string]any{}, nil)
	if err != nil {
		return errors.New("host TTS not running")
	}
	if code >= 400 {
		return errors.New("host TTS rejected the request")
	}
	return nil
}

func (h *ttsHub) request(ctx context.Context, method, path, token string, body, out any) (int, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		reader = bytes.NewReader(encoded)
	}
	requestCtx, cancel := context.WithTimeout(ctx, ttsTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, method, h.url+path, reader)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := h.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return response.StatusCode, err
	}
	if out != nil && response.StatusCode < 400 {
		if err := json.Unmarshal(raw, out); err != nil {
			return response.StatusCode, err
		}
	}
	return response.StatusCode, nil
}
