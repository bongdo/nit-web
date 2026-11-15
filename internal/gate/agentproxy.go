package gate

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"

	"nitgui/internal/gateid"
)

type machineView struct {
	Name      string        `json:"name"`
	Online    bool          `json:"online"`
	Added     int64         `json:"added"`
	Connected int64         `json:"connected,omitempty"`
	Version   string        `json:"version,omitempty"`
	Events    int64         `json:"events"`
	OpenCode  AgentOpenCode `json:"opencode"`
	Targets   []AgentTarget `json:"targets"`
	Dirs      []string      `json:"dirs"`
}

func (s *Server) machines(w http.ResponseWriter, r *http.Request) {
	id := identity(r)
	if id.Anonymous() {
		writeAuthError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if !id.Has(gateid.AdminHost) {
		writeAuthError(w, http.StatusForbidden, "admin only")
		return
	}
	list := struct {
		Machines []machineView `json:"machines"`
	}{Machines: []machineView{}}
	for _, machine := range s.agents.List() {
		view := machineView{Name: machine.Name, Added: machine.Added, Targets: []AgentTarget{}, Dirs: []string{}}
		if conn := s.hub.get(machine.Name); conn != nil {
			state, version, events := conn.snapshot()
			view.Online = true
			view.Connected = conn.connected.Unix()
			view.Version = version
			view.Events = events
			view.OpenCode = state.OpenCode
			view.Targets = state.Targets
			view.Dirs = state.Dirs
		}
		list.Machines = append(list.Machines, view)
	}
	data, err := json.Marshal(list)
	if err != nil {
		writeAuthError(w, http.StatusInternalServerError, "cannot list machines")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(data)
}

func (s *Server) instanceProxy(w http.ResponseWriter, r *http.Request) {
	id := identity(r)
	if id.Anonymous() {
		writeAuthError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if !id.Has(gateid.ReadPrivate) {
		writeAuthError(w, http.StatusForbidden, "no access to machines")
		return
	}
	machine, target, rest, ok := instancePath(r.URL)
	if !ok {
		writeAuthError(w, http.StatusNotFound, "unknown target")
		return
	}
	if !s.agents.Exists(machine) {
		writeAuthError(w, http.StatusNotFound, "unknown machine")
		return
	}
	conn := s.hub.get(machine)
	if conn == nil {
		writeAuthError(w, http.StatusBadGateway, "machine offline")
		return
	}
	if _, ok := conn.target(target); !ok {
		writeAuthError(w, http.StatusNotFound, "unknown target")
		return
	}
	select {
	case conn.inflight <- struct{}{}:
		defer func() { <-conn.inflight }()
	default:
		writeAuthError(w, http.StatusTooManyRequests, "too many requests")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, agentFrameLimit+1))
	if err != nil {
		writeAuthError(w, http.StatusBadRequest, "cannot read request body")
		return
	}
	if len(body) > agentFrameLimit {
		writeAuthError(w, http.StatusRequestEntityTooLarge, "request body is too large")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), agentRequestLimit)
	defer cancel()

	requestID, pending := conn.begin()
	defer conn.finish(requestID, pending)

	request := AgentFrame{
		Type:    "req",
		ID:      requestID,
		Target:  target,
		Method:  r.Method,
		Path:    rest,
		Headers: forwardHeaders(r.Header),
	}
	if len(body) > 0 {
		request.Body = base64.StdEncoding.EncodeToString(body)
	}
	if err := conn.send(request); err != nil {
		writeAuthError(w, http.StatusBadGateway, "machine is not reachable")
		return
	}

	started := false
	for {
		select {
		case frame := <-pending.frames:
			switch frame.Type {
			case "res":
				if frame.Error != "" || frame.Status == 0 {
					message := frame.Error
					if message == "" {
						message = "machine request failed"
					}
					writeAuthError(w, http.StatusBadGateway, message)
					return
				}
				copyResponseHeaders(w.Header(), frame.Headers)
				w.WriteHeader(frame.Status)
				flushResponse(w)
				started = true
			case "chunk":
				if !started {
					continue
				}
				chunk, err := base64.StdEncoding.DecodeString(frame.Body)
				if err != nil {
					return
				}
				if _, err := w.Write(chunk); err != nil {
					return
				}
				flushResponse(w)
			case "end":
				return
			}
		case <-conn.done:
			if !started {
				writeAuthError(w, http.StatusBadGateway, "machine disconnected")
			}
			return
		case <-ctx.Done():
			if !started {
				writeAuthError(w, http.StatusGatewayTimeout, "request timed out")
			}
			return
		}
	}
}

func instancePath(u *url.URL) (machine string, target string, rest string, ok bool) {
	escaped := u.EscapedPath()
	if !strings.HasPrefix(escaped, "/i/") {
		return "", "", "", false
	}
	parts := strings.Split(escaped[len("/i/"):], "/")
	if len(parts) < 2 {
		return "", "", "", false
	}
	machine, err := url.PathUnescape(parts[0])
	if err != nil || !validSegment(machine) {
		return "", "", "", false
	}
	target, err = url.PathUnescape(parts[1])
	if err != nil || !validSegment(target) {
		return "", "", "", false
	}
	rest = "/"
	if len(parts) > 2 {
		rest = "/" + strings.Join(parts[2:], "/")
	}
	if u.RawQuery != "" {
		rest += "?" + u.RawQuery
	}
	return machine, target, rest, true
}

func validSegment(name string) bool {
	if name == "" || name == "." || name == ".." || len(name) > 64 {
		return false
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
		default:
			return false
		}
	}
	return true
}

func forwardHeaders(header http.Header) map[string][]string {
	out := make(map[string][]string, len(header))
	for name, values := range header {
		if hopByHop(name) {
			continue
		}
		switch strings.ToLower(name) {
		case "cookie", "authorization", strings.ToLower(gateid.Header):
			continue
		}
		out[name] = append([]string(nil), values...)
	}
	return out
}

func copyResponseHeaders(dst http.Header, src map[string][]string) {
	for name, values := range src {
		if hopByHop(name) || strings.EqualFold(name, "Content-Length") {
			continue
		}
		for _, value := range values {
			dst.Add(name, value)
		}
	}
}

func hopByHop(name string) bool {
	switch strings.ToLower(name) {
	case "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
		"proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "content-length":
		return true
	}
	return false
}

func flushResponse(w http.ResponseWriter) {
	_ = http.NewResponseController(w).Flush()
}
