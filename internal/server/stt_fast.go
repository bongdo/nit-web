package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	fastSTTAddr   = "127.0.0.1:8178"
	fastSTTPrompt = "nit-gui, OpenCode, workspace, subagent, revert, fork, HTML, MCP, jj, save, диктовка, распознавание речи"
)

type fastSTT struct {
	log    *slog.Logger
	client *http.Client

	mu   sync.Mutex
	cmd  *exec.Cmd
	done chan struct{}
}

func newFastSTT(log *slog.Logger) *fastSTT {
	return &fastSTT{
		log:    log,
		client: &http.Client{Timeout: 2 * time.Minute},
	}
}

func fastSTTModel() string {
	if value := strings.TrimSpace(os.Getenv("NIT_GUI_STT_FAST_MODEL")); value != "" {
		return value
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local/share/whisper/ggml-small-q5_1.bin")
}

func (f *fastSTT) running() bool {
	if f.cmd == nil {
		return false
	}
	select {
	case <-f.done:
		return false
	default:
		return true
	}
}

func (f *fastSTT) ensure(ctx context.Context) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.running() {
		return nil
	}
	model := fastSTTModel()
	if _, err := os.Stat(model); err != nil {
		return fmt.Errorf("fast whisper model not found: %s", model)
	}
	bin := strings.TrimSpace(os.Getenv("NIT_GUI_WHISPER_SERVER"))
	if bin == "" {
		var err error
		bin, err = exec.LookPath("whisper-server")
		if err != nil {
			return fmt.Errorf("whisper-server not found")
		}
	}
	cmd := exec.Command(bin,
		"-m", model,
		"-l", "ru",
		"-t", "12",
		"-sns",
		"--prompt", fastSTTPrompt,
		"--host", "127.0.0.1",
		"--port", "8178",
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGTERM}
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan struct{})
	f.cmd = cmd
	f.done = done
	go func() {
		_ = cmd.Wait()
		close(done)
	}()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+fastSTTAddr+"/", nil)
		if err == nil {
			if response, err := f.client.Do(request); err == nil {
				response.Body.Close()
				f.log.Info("fast whisper server started", "addr", fastSTTAddr)
				return nil
			}
		}
		time.Sleep(150 * time.Millisecond)
	}
	return fmt.Errorf("fast whisper server did not start")
}

func (f *fastSTT) transcribe(ctx context.Context, data []byte) (string, error) {
	if err := f.ensure(ctx); err != nil {
		return "", err
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "audio.wav")
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	_ = writer.WriteField("response_format", "json")
	_ = writer.WriteField("language", "ru")
	_ = writer.WriteField("temperature", "0")
	if err := writer.Close(); err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"http://"+fastSTTAddr+"/inference", &body)
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := f.client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if response.StatusCode >= 400 {
		return "", fmt.Errorf("fast whisper returned %d: %s", response.StatusCode, strings.TrimSpace(string(raw)))
	}
	var out struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", err
	}
	return parseTranscription(out.Text), nil
}
