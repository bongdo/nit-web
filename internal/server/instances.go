package server

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"nitgui/internal/opencode"
)

type capabilityOut struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Owner    string `json:"owner"`
	State    string `json:"state"`
	Required bool   `json:"required"`
	Detail   string `json:"detail"`
}

type opencodeOut struct {
	OK      bool   `json:"ok"`
	Version string `json:"version"`
	Server  string `json:"server"`
}

type instanceOut struct {
	ID               string          `json:"id"`
	Name             string          `json:"name"`
	Transport        string          `json:"transport"`
	Detail           string          `json:"detail"`
	State            string          `json:"state"`
	Error            string          `json:"error"`
	OpenCode         opencodeOut     `json:"opencode"`
	DefaultDirectory string          `json:"defaultDirectory,omitempty"`
	Capabilities     []capabilityOut `json:"capabilities"`
}

func (s *Server) instances(w http.ResponseWriter, r *http.Request) {
	probeAll := r.URL.Query().Get("probe") == "all"
	specs := s.multi.Instances()
	instances := make([]instanceOut, 0, len(specs))
	for _, spec := range specs {
		instances = append(instances, s.instanceInfo(r.Context(), spec, probeAll))
	}
	host, _ := os.Hostname()
	host = strings.Split(host, ".")[0]
	writeJSON(w, http.StatusOK, map[string]any{
		"app":         map[string]string{"name": "nit-gui", "host": host, "version": "dev"},
		"default":     s.multi.DefaultInstance(),
		"configError": s.multi.ConfigError(),
		"instances":   instances,
	})
}

func (s *Server) instanceInfo(ctx context.Context, spec opencode.InstanceSpec, probeAll bool) instanceOut {
	out := instanceOut{
		ID:               spec.Name,
		Name:             spec.Name,
		Transport:        s.multi.Transport(spec.Name),
		Detail:           s.multi.Detail(spec.Name),
		State:            "unknown",
		DefaultDirectory: spec.Dir,
	}
	if spec.SSH != "" && !probeAll && !s.multi.Connected(spec.Name) {
		out.Error = s.multi.LastError(spec.Name)
		out.Capabilities = s.capabilities(ctx, "", "unknown", "not connected")
		return out
	}
	c, err := s.multi.ClientFor(ctx, spec.Name)
	if err != nil {
		out.State = "offline"
		out.Error = err.Error()
		out.Capabilities = s.capabilities(ctx, "", "unknown", "OpenCode unreachable")
		return out
	}
	probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var info struct {
		Version string `json:"version"`
	}
	if err := c.Do(probeCtx, http.MethodGet, "/api/info", nil, &info); err != nil {
		out.State = "offline"
		out.Error = err.Error()
		out.OpenCode.Server = c.BaseURL
		out.Capabilities = s.capabilities(ctx, "", "unknown", "OpenCode unreachable")
		return out
	}
	out.State = "connected"
	out.OpenCode = opencodeOut{OK: true, Version: info.Version, Server: c.BaseURL}
	out.Capabilities = s.capabilities(ctx, info.Version, "on", "")
	return out
}

func (s *Server) capabilities(ctx context.Context, version, chatState, chatDetail string) []capabilityOut {
	if chatDetail == "" {
		chatDetail = "OpenCode " + version
	}
	return []capabilityOut{
		{ID: "chat", Label: "Chat & sessions", Owner: "opencode", State: chatState, Required: true, Detail: chatDetail},
		s.dictationCapability(),
		s.grammarCapability(ctx),
		{ID: "speech", Label: "Speech", Owner: "opencode", State: "off", Detail: "host TTS not connected"},
		{ID: "spelling", Label: "Spelling", Owner: "browser", State: "fallback", Detail: "nspell RU+EN · this device"},
	}
}

func (s *Server) dictationCapability() capabilityOut {
	fastOK, _ := s.fast.available()
	accurateOK, _ := accurateSTTAvailable()
	state := "off"
	detail := "not installed on the nit-gui host"
	switch {
	case fastOK && accurateOK:
		state, detail = "on", "fast + accurate"
	case fastOK:
		state, detail = "on", "fast only"
	case accurateOK:
		state, detail = "on", "accurate only"
	}
	return capabilityOut{ID: "dictation", Label: "Dictation", Owner: "nit-gui", State: state, Detail: detail}
}

func (s *Server) grammarCapability(ctx context.Context) capabilityOut {
	ok, detail := s.grammar.available(ctx)
	state := "off"
	if ok {
		state = "on"
	}
	return capabilityOut{ID: "grammar", Label: "Grammar", Owner: "nit-gui", State: state, Detail: detail}
}


