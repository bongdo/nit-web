package gate

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	auditKeep = 500
	auditMax  = 512 << 10
)

type AuditEvent struct {
	Time   int64  `json:"time"`
	User   string `json:"user,omitempty"`
	IP     string `json:"ip,omitempty"`
	Agent  string `json:"agent,omitempty"`
	Result string `json:"result"`
	Temp   bool   `json:"temp,omitempty"`
}

type Audit struct {
	mu   sync.Mutex
	path string
	now  func() time.Time
}

func DefaultAuditPath() string {
	if path := strings.TrimSpace(os.Getenv("NIT_GATE_AUDIT")); path != "" {
		return path
	}
	return filepath.Join(filepath.Dir(DefaultUsersPath()), "audit.jsonl")
}

func OpenAudit(path string) *Audit {
	return &Audit{path: path, now: time.Now}
}

func (a *Audit) Add(event AuditEvent) {
	if a == nil || a.path == "" {
		return
	}
	event.Time = a.now().Unix()
	data, err := json.Marshal(event)
	if err != nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(a.path), 0o700); err != nil {
		return
	}
	file, err := os.OpenFile(a.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	_, _ = file.Write(append(data, '\n'))
	_ = file.Close()
	if info, err := os.Stat(a.path); err == nil && info.Size() > auditMax {
		a.compactLocked()
	}
}

func (a *Audit) Last(limit int) []AuditEvent {
	if a == nil || a.path == "" || limit <= 0 {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	lines := a.linesLocked()
	if len(lines) > limit {
		lines = lines[len(lines)-limit:]
	}
	events := make([]AuditEvent, 0, len(lines))
	for i := len(lines) - 1; i >= 0; i-- {
		var event AuditEvent
		if err := json.Unmarshal([]byte(lines[i]), &event); err == nil {
			events = append(events, event)
		}
	}
	return events
}

func (a *Audit) compactLocked() {
	lines := a.linesLocked()
	if len(lines) > auditKeep {
		lines = lines[len(lines)-auditKeep:]
	}
	tmp := a.path + ".tmp"
	body := strings.Join(lines, "\n")
	if body != "" {
		body += "\n"
	}
	if err := os.WriteFile(tmp, []byte(body), 0o600); err != nil {
		return
	}
	_ = os.Rename(tmp, a.path)
}

func (a *Audit) linesLocked() []string {
	file, err := os.Open(a.path)
	if err != nil {
		return nil
	}
	defer file.Close()
	var lines []string
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64<<10), 1<<20)
	for scanner.Scan() {
		if line := strings.TrimSpace(scanner.Text()); line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}
