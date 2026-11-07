package server

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

var (
	errPiperExited = errors.New("host voice stopped")
	errPiperNoAudio = errors.New("host voice produced no audio")
)

type piperProcess struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	exited  chan struct{}
	waitErr error
}

type piperWorker struct {
	binary string
	model  string
	rate   float64

	mu   sync.Mutex
	proc *piperProcess
	dir  string
	seq  int
}

func newPiperWorker(binary, model string, rate float64) *piperWorker {
	return &piperWorker{binary: binary, model: model, rate: rate}
}

func (w *piperWorker) synthesize(ctx context.Context, text string) ([]byte, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := w.ensure(); err != nil {
		return nil, err
	}
	for attempt := 0; attempt < 2; attempt++ {
		path, err := w.write(text)
		if err != nil {
			w.stop()
			if err := w.ensure(); err != nil {
				return nil, err
			}
			continue
		}
		data, err := w.wait(ctx, path)
		if err == nil {
			return data, nil
		}
		w.stop()
		if ctx.Err() != nil {
			return nil, err
		}
		if !errors.Is(err, errPiperExited) {
			return nil, err
		}
		if err := w.ensure(); err != nil {
			return nil, err
		}
	}
	return nil, errPiperExited
}

func (w *piperWorker) ensure() error {
	if w.proc != nil {
		return nil
	}
	if w.dir == "" {
		dir, err := os.MkdirTemp("", "nit-gui-piper-")
		if err != nil {
			return errors.New("host voice could not start")
		}
		w.dir = dir
	}
	lengthScale := strconv.FormatFloat(1/w.rate, 'f', -1, 64)
	cmd := exec.Command(w.binary, "-m", w.model, "--json-input", "-q", "--length_scale", lengthScale)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return errors.New("host voice could not start")
	}
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return errors.New("host voice could not start")
	}
	proc := &piperProcess{cmd: cmd, stdin: stdin, exited: make(chan struct{})}
	w.proc = proc
	go func() {
		proc.waitErr = cmd.Wait()
		close(proc.exited)
	}()
	return nil
}

func (w *piperWorker) write(text string) (string, error) {
	if w.proc == nil {
		return "", errPiperExited
	}
	w.seq++
	path := filepath.Join(w.dir, "segment-"+strconv.Itoa(w.seq)+".wav")
	line, err := json.Marshal(map[string]string{"text": text, "output_file": path})
	if err != nil {
		return "", err
	}
	if _, err := w.proc.stdin.Write(append(line, '\n')); err != nil {
		return "", errPiperExited
	}
	return path, nil
}

func (w *piperWorker) wait(ctx context.Context, path string) ([]byte, error) {
	defer os.Remove(path)
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	var last int64 = -1
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-w.procExited():
			return nil, errPiperExited
		case <-ticker.C:
		}
		info, err := os.Stat(path)
		if err != nil || info.Size() < 44 || info.Size() == last {
			continue
		}
		last = info.Size()
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		if complete, ok := wavComplete(data); ok {
			if !complete {
				continue
			}
			if len(data) == 0 {
				return nil, errPiperNoAudio
			}
			return data, nil
		}
	}
}

func (w *piperWorker) procExited() <-chan struct{} {
	if w.proc == nil {
		done := make(chan struct{})
		close(done)
		return done
	}
	return w.proc.exited
}

func (w *piperWorker) stop() {
	proc := w.proc
	w.proc = nil
	if proc == nil {
		return
	}
	_ = proc.stdin.Close()
	if proc.cmd.Process != nil {
		_ = proc.cmd.Process.Kill()
	}
}

func wavComplete(data []byte) (complete bool, ok bool) {
	if len(data) < 12 || string(data[0:4]) != "RIFF" || string(data[8:12]) != "WAVE" {
		return false, false
	}
	declared := uint64(binary.LittleEndian.Uint32(data[4:8])) + 8
	if uint64(len(data)) < declared {
		return false, true
	}
	for offset := 12; offset+8 <= len(data); {
		id := string(data[offset : offset+4])
		size := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		if size < 0 || offset+8+size > len(data) {
			return false, true
		}
		if id == "data" {
			return size > 0, true
		}
		offset += 8 + size
	}
	return false, true
}

func wavPCM(data []byte) ([]byte, int, bool) {
	if len(data) < 12 || string(data[0:4]) != "RIFF" || string(data[8:12]) != "WAVE" {
		return nil, 0, false
	}
	rate := 0
	for offset := 12; offset+8 <= len(data); {
		id := string(data[offset : offset+4])
		size := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		if size < 0 || offset+8+size > len(data) {
			return nil, 0, false
		}
		payload := data[offset+8 : offset+8+size]
		if id == "fmt " && len(payload) >= 8 {
			rate = int(binary.LittleEndian.Uint32(payload[4:8]))
		}
		if id == "data" {
			return payload, rate, true
		}
		offset += 8 + size
	}
	return nil, 0, false
}
