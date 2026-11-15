package gate

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	agentProtocol      = 1
	agentPingInterval  = 20 * time.Second
	agentIdleTimeout   = 45 * time.Second
	agentHelloTimeout  = 10 * time.Second
	agentFrameLimit    = 1 << 20
	agentMaxInflight   = 32
	agentRequestLimit  = 120 * time.Second
	agentChunkCapacity = 8
)

type AgentOpenCode struct {
	Version string `json:"version"`
	URL     string `json:"url"`
}

type AgentTarget struct {
	Name   string `json:"name"`
	Kind   string `json:"kind,omitempty"`
	Detail string `json:"detail,omitempty"`
}

type AgentState struct {
	OpenCode AgentOpenCode `json:"opencode"`
	Targets  []AgentTarget `json:"targets"`
	Dirs     []string      `json:"dirs"`
}

type AgentFrame struct {
	Type     string              `json:"type"`
	Name     string              `json:"name,omitempty"`
	Protocol int                 `json:"protocol,omitempty"`
	Version  string              `json:"version,omitempty"`
	Session  string              `json:"session,omitempty"`
	Time     int64               `json:"time,omitempty"`
	OpenCode *AgentOpenCode      `json:"opencode,omitempty"`
	Targets  []AgentTarget       `json:"targets,omitempty"`
	Dirs     []string            `json:"dirs,omitempty"`
	Event    json.RawMessage     `json:"event,omitempty"`
	ID       string              `json:"id,omitempty"`
	Target   string              `json:"target,omitempty"`
	Method   string              `json:"method,omitempty"`
	Path     string              `json:"path,omitempty"`
	Headers  map[string][]string `json:"headers,omitempty"`
	Body     string              `json:"body,omitempty"`
	Status   int                 `json:"status,omitempty"`
	Error    string              `json:"error,omitempty"`
}

type agentPending struct {
	frames chan AgentFrame
	done   chan struct{}
}

type agentConn struct {
	name     string
	hash     string
	ws       *WSConn
	agents   *Agents
	hub      *agentHub
	log      *slog.Logger
	inflight chan struct{}
	done     chan struct{}
	seq      atomic.Uint64
	closeOne sync.Once

	mu        sync.Mutex
	pending   map[string]*agentPending
	state     AgentState
	events    int64
	connected time.Time
}

type agentHub struct {
	mu    sync.Mutex
	conns map[string]*agentConn
}

func newAgentHub() *agentHub {
	return &agentHub{conns: map[string]*agentConn{}}
}

func (h *agentHub) attach(c *agentConn) {
	h.mu.Lock()
	old := h.conns[c.name]
	h.conns[c.name] = c
	h.mu.Unlock()
	if old != nil {
		old.close(1000, "replaced by a new connection")
	}
}

func (h *agentHub) remove(c *agentConn) {
	h.mu.Lock()
	if h.conns[c.name] == c {
		delete(h.conns, c.name)
	}
	h.mu.Unlock()
}

func (h *agentHub) get(name string) *agentConn {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.conns[name]
}

func (c *agentConn) close(code int, reason string) {
	c.closeOne.Do(func() {
		_ = c.ws.WriteClose(code, reason)
		_ = c.ws.Close()
		close(c.done)
	})
}

func (s *Server) agentSocket(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r.Header.Get("Authorization"))
	machine, ok := s.agents.Authorize(token)
	if !ok {
		w.Header().Set("WWW-Authenticate", `Bearer realm="agent"`)
		writeAuthError(w, http.StatusUnauthorized, "unknown machine token")
		return
	}
	ws, err := AcceptWebSocket(w, r)
	if err != nil {
		return
	}
	c := &agentConn{
		name:      machine.Name,
		hash:      machine.TokenHash,
		ws:        ws,
		agents:    s.agents,
		hub:       s.hub,
		log:       s.log,
		inflight:  make(chan struct{}, agentMaxInflight),
		done:      make(chan struct{}),
		pending:   map[string]*agentPending{},
		connected: time.Now(),
	}
	c.serve()
}

func bearerToken(header string) string {
	value := strings.TrimSpace(header)
	if len(value) < 7 || !strings.EqualFold(value[:7], "bearer ") {
		return ""
	}
	return strings.TrimSpace(value[7:])
}

func (c *agentConn) serve() {
	defer c.hub.remove(c)
	defer c.close(1001, "closing")
	c.ws.SetReadDeadline(time.Now().Add(agentHelloTimeout))
	op, data, err := c.ws.ReadMessage()
	if err != nil {
		return
	}
	var hello AgentFrame
	if op != wsText || json.Unmarshal(data, &hello) != nil || hello.Type != "hello" {
		c.close(1002, "hello required")
		return
	}
	if hello.Name != c.name {
		c.close(1008, "machine name does not match token")
		return
	}
	if hello.Protocol != agentProtocol {
		c.close(1002, "unsupported protocol version")
		return
	}
	if err := c.ws.WriteJSON(AgentFrame{Type: "welcome", Session: randomSession(), Time: time.Now().Unix()}); err != nil {
		return
	}
	c.hub.attach(c)
	c.ws.SetIdleTimeout(agentIdleTimeout)
	c.log.Info("agent connected", "machine", c.name, "version", hello.Version)

	stop := make(chan struct{})
	defer close(stop)
	go c.heartbeat(stop)

	for {
		op, data, err := c.ws.ReadMessage()
		if err != nil {
			c.log.Debug("agent socket closed", "machine", c.name, "error", err)
			return
		}
		if op != wsText {
			continue
		}
		c.handle(data)
	}
}

func (c *agentConn) heartbeat(stop chan struct{}) {
	ticker := time.NewTicker(agentPingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-c.done:
			return
		case <-ticker.C:
			if !c.agents.Active(c.name, c.hash) {
				c.log.Info("agent token revoked", "machine", c.name)
				c.close(1008, "token revoked")
				return
			}
			if err := c.ws.WritePing(); err != nil {
				c.close(1001, "ping failed")
				return
			}
		}
	}
}

func (c *agentConn) handle(data []byte) {
	var frame AgentFrame
	if json.Unmarshal(data, &frame) != nil {
		c.log.Debug("agent frame ignored", "machine", c.name, "bytes", len(data))
		return
	}
	switch frame.Type {
	case "state":
		state := AgentState{}
		if frame.OpenCode != nil {
			state.OpenCode = *frame.OpenCode
		}
		state.Targets = frame.Targets
		if state.Targets == nil {
			state.Targets = []AgentTarget{}
		}
		state.Dirs = frame.Dirs
		if state.Dirs == nil {
			state.Dirs = []string{}
		}
		c.mu.Lock()
		c.state = state
		c.mu.Unlock()
	case "evt":
		atomic.AddInt64(&c.events, 1)
		c.log.Debug("agent event", "machine", c.name)
	case "res", "chunk", "end":
		c.deliver(frame)
	}
}

func (c *agentConn) deliver(frame AgentFrame) {
	c.mu.Lock()
	pending := c.pending[frame.ID]
	c.mu.Unlock()
	if pending == nil {
		return
	}
	select {
	case pending.frames <- frame:
	case <-pending.done:
	}
}

func (c *agentConn) send(frame AgentFrame) error {
	payload, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	if len(payload) > agentFrameLimit {
		return errWSFrameTooLarge
	}
	return c.ws.WriteText(payload)
}

func (c *agentConn) begin() (string, *agentPending) {
	id := strconv.FormatUint(c.seq.Add(1), 10)
	pending := &agentPending{frames: make(chan AgentFrame, agentChunkCapacity), done: make(chan struct{})}
	c.mu.Lock()
	c.pending[id] = pending
	c.mu.Unlock()
	return id, pending
}

func (c *agentConn) finish(id string, pending *agentPending) {
	c.mu.Lock()
	delete(c.pending, id)
	c.mu.Unlock()
	close(pending.done)
}

func (c *agentConn) target(name string) (AgentTarget, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, target := range c.state.Targets {
		if target.Name == name {
			return target, true
		}
	}
	return AgentTarget{}, false
}

func (c *agentConn) snapshot() (AgentState, int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state, atomic.LoadInt64(&c.events)
}

func randomSession() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(buf)
}
