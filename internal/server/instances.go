package server

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
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
	URL              string          `json:"url,omitempty"`
	SSH              string          `json:"ssh,omitempty"`
	OpenCode         opencodeOut     `json:"opencode"`
	DefaultDirectory string          `json:"defaultDirectory,omitempty"`
	Capabilities     []capabilityOut `json:"capabilities"`
}

func (s *Server) instances(w http.ResponseWriter, r *http.Request) {
	probeAll := r.URL.Query().Get("probe") == "all"
	shared := s.sharedCapabilities(r.Context())
	specs := s.multi.Instances()
	instances := make([]instanceOut, 0, len(specs))
	for _, spec := range specs {
		instances = append(instances, s.instanceInfo(r.Context(), spec, probeAll, shared))
	}
	host := s.publicHost
	if host == "" {
		host, _ = os.Hostname()
	}
	host = strings.Split(host, ".")[0]
	writeJSON(w, http.StatusOK, map[string]any{
		"app":         map[string]string{"name": "nit-gui", "host": host, "version": "dev"},
		"default":     s.multi.DefaultInstance(),
		"configPath":  s.multi.ConfigPath(),
		"configError": s.multi.ConfigError(),
		"instances":   instances,
	})
}

type sharedCapabilities struct {
	dictation capabilityOut
	grammar   capabilityOut
	speech    capabilityOut
}

func (s *Server) sharedCapabilities(ctx context.Context) sharedCapabilities {
	return sharedCapabilities{
		dictation: s.dictationCapability(),
		grammar:   s.grammarCapability(ctx),
		speech:    s.speechCapability(ctx),
	}
}

func (s *Server) instanceInfo(ctx context.Context, spec opencode.InstanceSpec, probeAll bool, shared sharedCapabilities) instanceOut {
	out := instanceOut{
		ID:               spec.Name,
		Name:             spec.Name,
		Transport:        s.multi.Transport(spec.Name),
		Detail:           s.multi.Detail(spec.Name),
		State:            "unknown",
		URL:              instanceURL(spec.URL),
		SSH:              spec.SSH,
		DefaultDirectory: spec.Dir,
	}
	if spec.SSH != "" && !probeAll && !s.multi.Connected(spec.Name) {
		out.Error = s.multi.LastError(spec.Name)
		if out.Error != "" {
			out.State = "offline"
		}
		out.Capabilities = s.capabilities("", "unknown", "not connected", shared)
		return out
	}
	c, err := s.multi.ClientFor(ctx, spec.Name)
	if err != nil {
		out.State = "offline"
		out.Error = err.Error()
		out.Capabilities = s.capabilities("", "unknown", "OpenCode unreachable", shared)
		return out
	}
	probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var info struct {
		Version string `json:"version"`
	}
	if err := c.Do(probeCtx, http.MethodGet, "/api/info", nil, &info); err != nil {
		s.multi.DropFor(spec.Name)
		out.State = "offline"
		out.Error = err.Error()
		out.OpenCode.Server = c.BaseURL
		out.Capabilities = s.capabilities("", "unknown", "OpenCode unreachable", shared)
		return out
	}
	out.State = "connected"
	out.OpenCode = opencodeOut{OK: true, Version: info.Version, Server: c.BaseURL}
	out.Capabilities = s.capabilities(info.Version, "on", "", shared)
	return out
}

func (s *Server) capabilities(version, chatState, chatDetail string, shared sharedCapabilities) []capabilityOut {
	if chatDetail == "" {
		chatDetail = "OpenCode " + version
	}
	return []capabilityOut{
		{ID: "chat", Label: "Chat & sessions", Owner: "opencode", State: chatState, Required: true, Detail: chatDetail},
		shared.dictation,
		shared.grammar,
		shared.speech,
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

func (s *Server) speechCapability(ctx context.Context) capabilityOut {
	ok, clients, detail := false, 0, "host TTS not configured"
	if s.tts != nil {
		ok, clients, detail = s.tts.status(ctx)
	}
	switch {
	case ok && clients > 0:
		return capabilityOut{ID: "speech", Label: "Speech", Owner: "opencode", State: "on", Detail: fmt.Sprintf("host TTS · %d audio client(s)", clients)}
	case ok:
		return capabilityOut{ID: "speech", Label: "Speech", Owner: "browser", State: "fallback", Detail: "host TTS hub up · no audio client"}
	default:
		return capabilityOut{ID: "speech", Label: "Speech", Owner: "opencode", State: "off", Detail: detail}
	}
}

func (s *Server) grammarCapability(ctx context.Context) capabilityOut {
	ok, detail := s.grammar.available(ctx)
	state := "off"
	if ok {
		state = "on"
	}
	return capabilityOut{ID: "grammar", Label: "Grammar", Owner: "nit-gui", State: state, Detail: detail}
}

func instanceURL(raw string) string {
	if raw == "" || raw == "auto" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	parsed.User = nil
	return parsed.String()
}
