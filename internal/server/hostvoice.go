package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultPiperModel  = "ru_RU-irina-medium.onnx"
	defaultPiperRate   = 22050
	maxHostVoiceBytes  = 32 << 20
	hostVoiceTimeout   = 60 * time.Second
	piperSentencePause = "0.3"
)

type hostVoice struct {
	engine      string
	contentType string
	detail      string
	binary      string
	model       string
	rate        float64
	sampleRate  int

	mu         sync.Mutex
	worker     *piperWorker
	workerRate float64
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
	if engine == "piper" {
		voice.engine = "piper"
		voice.contentType = "audio/wav"
		voice.detail = "host voice · piper"
		voice.binary = ttsPiperBinary()
		voice.model = ttsPiperModel()
		voice.sampleRate = piperSampleRate(voice.model)
	}
	return voice
}

func autoVoiceEngine() string {
	if binaryExists(ttsPiperBinary()) && fileExists(ttsPiperModel()) {
		return "piper"
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

func (v *hostVoice) synthesize(ctx context.Context, text string, rate float64) ([]byte, string, error) {
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
	rate = v.rateFor(rate)
	if worker := v.workerAt(rate); worker != nil {
		if data, err := worker.synthesize(runCtx, text); err == nil {
			return data, v.contentType, nil
		} else if runCtx.Err() != nil {
			return nil, "", voiceRunError(runCtx, "piper")
		}
	}
	if v.engine == "piper" {
		return v.piper(runCtx, text, rate)
	}
	return nil, "", errors.New("host voice is not configured")
}

func (v *hostVoice) warm() error {
	if v == nil || !v.available() || v.engine != "piper" {
		return errors.New("host voice is not available")
	}
	return v.workerAt(0).start()
}

func (v *hostVoice) streamAvailable() bool {
	return v != nil && v.engine == "piper" && v.available()
}

func (v *hostVoice) stream(ctx context.Context, text string, rate float64, out io.Writer) error {
	if !v.streamAvailable() {
		return errors.New("host voice streaming is not available")
	}
	runCtx, cancel := context.WithTimeout(ctx, hostVoiceTimeout)
	defer cancel()
	rate = v.rateFor(rate)
	if worker := v.workerAt(rate); worker != nil {
		if wav, err := worker.synthesize(runCtx, text); err == nil {
			if pcm, _, ok := wavPCM(wav); ok {
				_, err := out.Write(pcm)
				return err
			}
		} else if runCtx.Err() != nil {
			return voiceRunError(runCtx, "piper")
		}
	}
	lengthScale := strconv.FormatFloat(1/rate, 'f', -1, 64)
	cmd := exec.CommandContext(runCtx, v.binary, "-m", v.model, "-f", "-", "--output_raw", "-q", "--length_scale", lengthScale, "--sentence_silence", piperSentencePause)
	cmd.Stdin = strings.NewReader(text + "\n")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return errors.New("host voice could not start")
	}
	if err := cmd.Start(); err != nil {
		return errors.New("host voice could not start")
	}
	if _, err := io.Copy(out, stdout); err != nil {
		_ = cmd.Wait()
		return voiceRunError(runCtx, "piper")
	}
	if err := cmd.Wait(); err != nil {
		return voiceRunError(runCtx, "piper")
	}
	return nil
}

func (v *hostVoice) rateFor(rate float64) float64 {
	if math.IsNaN(rate) || math.IsInf(rate, 0) || rate <= 0 {
		rate = v.rate
	}
	if rate < 0.5 {
		return 0.5
	}
	if rate > 2 {
		return 2
	}
	return rate
}

func (v *hostVoice) workerAt(rate float64) *piperWorker {
	if v == nil || v.engine != "piper" {
		return nil
	}
	rate = v.rateFor(rate)
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.worker != nil && v.workerRate == rate {
		return v.worker
	}
	if v.worker != nil {
		v.worker.shutdown()
	}
	v.worker = newPiperWorker(v.binary, v.model, rate)
	v.workerRate = rate
	return v.worker
}

func (v *hostVoice) shutdown() {
	if v == nil {
		return
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.worker != nil {
		v.worker.shutdown()
		v.worker = nil
	}
}

func (v *hostVoice) rateHz() int {
	if v == nil || v.sampleRate <= 0 {
		return defaultPiperRate
	}
	return v.sampleRate
}

func piperSampleRate(model string) int {
	raw, err := os.ReadFile(model + ".json")
	if err != nil {
		return defaultPiperRate
	}
	var config struct {
		Audio struct {
			SampleRate int `json:"sample_rate"`
		} `json:"audio"`
	}
	if json.Unmarshal(raw, &config) != nil || config.Audio.SampleRate <= 0 {
		return defaultPiperRate
	}
	return config.Audio.SampleRate
}

func (v *hostVoice) piper(ctx context.Context, text string, rate float64) ([]byte, string, error) {
	path, cleanup, err := voiceTempFile("*.wav")
	if err != nil {
		return nil, "", err
	}
	defer cleanup()
	lengthScale := strconv.FormatFloat(1/rate, 'f', -1, 64)
	cmd := exec.CommandContext(ctx, v.binary, "-m", v.model, "-f", path, "-q", "--length_scale", lengthScale, "--sentence_silence", piperSentencePause)
	cmd.Stdin = strings.NewReader(text + "\n")
	if err := cmd.Run(); err != nil {
		return nil, "", voiceRunError(ctx, "piper")
	}
	return readVoiceOutput(path, v.contentType)
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
