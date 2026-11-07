package server

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	defaultPiperModel = "ru_RU-irina-medium.onnx"
	defaultEdgeVoice  = "ru-RU-SvetlanaNeural"
	maxHostVoiceBytes = 32 << 20
	hostVoiceTimeout  = 60 * time.Second
)

type hostVoice struct {
	engine      string
	contentType string
	detail      string
	binary      string
	model       string
	voice       string
	rate        float64
}

func newHostVoice() *hostVoice {
	voice := &hostVoice{rate: ttsRate()}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("NIT_GUI_TTS")), "off") {
		return voice
	}
	engine := strings.ToLower(strings.TrimSpace(os.Getenv("NIT_GUI_TTS_ENGINE")))
	if engine == "" || engine == "auto" {
		engine = autoVoiceEngine()
	}
	switch engine {
	case "piper":
		voice.engine = "piper"
		voice.contentType = "audio/wav"
		voice.detail = "host voice · piper"
		voice.binary = ttsPiperBinary()
		voice.model = ttsPiperModel()
	case "edge":
		voice.engine = "edge"
		voice.contentType = "audio/mpeg"
		voice.detail = "host voice · edge-tts"
		voice.binary = ttsEdgeBinary()
		voice.voice = ttsEdgeVoice()
	}
	return voice
}

func autoVoiceEngine() string {
	if binaryExists(ttsPiperBinary()) && fileExists(ttsPiperModel()) {
		return "piper"
	}
	if binaryExists(ttsEdgeBinary()) {
		return "edge"
	}
	return ""
}

func ttsPiperBinary() string {
	if bin := strings.TrimSpace(os.Getenv("NIT_GUI_TTS_PIPER")); bin != "" {
		return expandHome(bin)
	}
	return "piper"
}

func ttsPiperModel() string {
	if path := strings.TrimSpace(os.Getenv("NIT_GUI_TTS_PIPER_MODEL")); path != "" {
		return expandHome(path)
	}
	data := strings.TrimSpace(os.Getenv("XDG_DATA_HOME"))
	if data == "" {
		if home, err := os.UserHomeDir(); err == nil {
			data = filepath.Join(home, ".local", "share")
		}
	}
	return filepath.Join(data, "piper-voices", defaultPiperModel)
}

func ttsEdgeBinary() string {
	if bin := strings.TrimSpace(os.Getenv("NIT_GUI_TTS_EDGE")); bin != "" {
		return expandHome(bin)
	}
	return "edge-tts"
}

func ttsEdgeVoice() string {
	if voice := strings.TrimSpace(os.Getenv("NIT_GUI_TTS_EDGE_VOICE")); voice != "" {
		return voice
	}
	return defaultEdgeVoice
}

func ttsRate() float64 {
	raw := strings.TrimSpace(os.Getenv("NIT_GUI_TTS_RATE"))
	if raw == "" {
		return 1
	}
	rate, err := strconv.ParseFloat(raw, 64)
	if err != nil || rate <= 0 || math.IsInf(rate, 0) || math.IsNaN(rate) {
		return 1
	}
	return rate
}

func binaryExists(bin string) bool {
	if bin == "" {
		return false
	}
	if strings.ContainsRune(bin, filepath.Separator) {
		info, err := os.Stat(bin)
		return err == nil && !info.IsDir() && info.Mode()&0o111 != 0
	}
	_, err := exec.LookPath(bin)
	return err == nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func (v *hostVoice) available() bool {
	if v == nil || v.engine == "" || !binaryExists(v.binary) {
		return false
	}
	return v.engine != "piper" || fileExists(v.model)
}

func (v *hostVoice) synthesize(ctx context.Context, text string) ([]byte, string, error) {
	if v == nil || v.engine == "" {
		return nil, "", errors.New("host voice is not configured")
	}
	text, err := ttsText(text)
	if err != nil {
		return nil, "", err
	}
	if !v.available() {
		return nil, "", errors.New("host voice is not available")
	}
	runCtx, cancel := context.WithTimeout(ctx, hostVoiceTimeout)
	defer cancel()
	switch v.engine {
	case "piper":
		return v.piper(runCtx, text)
	case "edge":
		return v.edge(runCtx, text)
	}
	return nil, "", errors.New("host voice is not configured")
}

func (v *hostVoice) piper(ctx context.Context, text string) ([]byte, string, error) {
	path, cleanup, err := voiceTempFile("*.wav")
	if err != nil {
		return nil, "", err
	}
	defer cleanup()
	lengthScale := strconv.FormatFloat(1/v.rate, 'f', -1, 64)
	cmd := exec.CommandContext(ctx, v.binary, "-m", v.model, "-f", path, "-q", "--length_scale", lengthScale)
	cmd.Stdin = strings.NewReader(text + "\n")
	if err := cmd.Run(); err != nil {
		return nil, "", voiceRunError(ctx, "piper")
	}
	return readVoiceOutput(path, v.contentType)
}

func (v *hostVoice) edge(ctx context.Context, text string) ([]byte, string, error) {
	path, cleanup, err := voiceTempFile("*.mp3")
	if err != nil {
		return nil, "", err
	}
	defer cleanup()
	args := []string{"--text=" + text, "--write-media", path, "--voice", v.voice}
	if percent := edgeRatePercent(v.rate); percent != "" {
		args = append(args, "--rate="+percent)
	}
	cmd := exec.CommandContext(ctx, v.binary, args...)
	if err := cmd.Run(); err != nil {
		return nil, "", voiceRunError(ctx, "edge-tts")
	}
	return readVoiceOutput(path, v.contentType)
}

func edgeRatePercent(rate float64) string {
	percent := int(math.Round((rate - 1) * 100))
	if percent == 0 {
		return ""
	}
	return fmt.Sprintf("%+d%%", percent)
}

func voiceTempFile(pattern string) (string, func(), error) {
	file, err := os.CreateTemp("", "nit-gui-tts-"+pattern)
	if err != nil {
		return "", func() {}, errors.New("host voice could not start")
	}
	path := file.Name()
	file.Close()
	return path, func() { _ = os.Remove(path) }, nil
}

func voiceRunError(ctx context.Context, name string) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return errors.New("host voice timed out")
	}
	return fmt.Errorf("host voice %s failed", name)
}

func readVoiceOutput(path, contentType string) ([]byte, string, error) {
	info, err := os.Stat(path)
	if err != nil || info.Size() == 0 {
		return nil, "", errors.New("host voice produced no audio")
	}
	if info.Size() > maxHostVoiceBytes {
		return nil, "", errors.New("host voice output is too large")
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		return nil, "", errors.New("host voice produced no audio")
	}
	return data, contentType, nil
}
