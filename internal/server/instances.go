package server

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
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
	PeroURL          string          `json:"peroURL,omitempty"`
	TermURL          string          `json:"termURL,omitempty"`
	OpenCode         opencodeOut     `json:"opencode"`
	DefaultDirectory string          `json:"defaultDirectory,omitempty"`
	Capabilities     []capabilityOut `json:"capabilities"`
}

func (s *Server) instances(w http.ResponseWriter, r *http.Request) {
	probe := r.URL.Query().Get("probe")
	probeAll := probe == "all"
	probeNone := probe == "none"
	shared := sharedCapabilities{
		grammar: capabilityOut{ID: "grammar", Label: "Grammar", Owner: "nit-gui", State: "unknown", Detail: "not probed"},
		speech:  capabilityOut{ID: "speech", Label: "Speech", Owner: "opencode", State: "unknown", Detail: "not probed"},
	}
	if !probeNone {
		shared = s.sharedCapabilities(r.Context())
	}
	specs := s.multi.Instances()
	instances := make([]instanceOut, len(specs))
	if probeNone {
		for i, spec := range specs {
			instances[i] = s.instanceInfo(r.Context(), spec, probeAll, probeNone, shared)
		}
	} else {
		sem := make(chan struct{}, 4)
		var wg sync.WaitGroup
		for i, spec := range specs {
			wg.Add(1)
			go func(i int, spec opencode.InstanceSpec) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				instances[i] = s.instanceInfo(r.Context(), spec, probeAll, probeNone, shared)
			}(i, spec)
		}
		wg.Wait()
	}
	host := s.publicHost
	if host == "" {
		host, _ = os.Hostname()
	}
	host = strings.Split(host, ".")[0]
	writeJSON(w, http.StatusOK, map[string]any{
		"app":         map[string]string{"name": "nit-gui", "host": host, "version": "dev"},
		"default":     s.multi.DefaultInstance(),
		"defaults":    map[string]string{"peroURL": s.peroURL, "termURL": s.termURL},
		"configPath":  s.multi.ConfigPath(),
		"configError": s.multi.ConfigError(),
		"instances":   instances,
	})
}

type sharedCapabilities struct {
	grammar capabilityOut
	speech  capabilityOut
}

func (s *Server) sharedCapabilities(ctx context.Context) sharedCapabilities {
	return sharedCapabilities{
		grammar: s.grammarCapability(ctx),
		speech:  s.speechCapability(ctx),
	}
}

func (s *Server) instanceInfo(ctx context.Context, spec opencode.InstanceSpec, probeAll, probeNone bool, shared sharedCapabilities) instanceOut {
	out := instanceOut{
		ID:               spec.Name,
		Name:             spec.Name,
		Transport:        s.multi.Transport(spec.Name),
		Detail:           s.multi.Detail(spec.Name),
		State:            "unknown",
		URL:              instanceURL(spec.URL),
		SSH:              spec.SSH,
		PeroURL:          spec.PeroURL,
		TermURL:          spec.TermURL,
		DefaultDirectory: spec.Dir,
	}
	if probeNone {
		if s.multi.Connected(spec.Name) {
			out.State = "connected"
		}
		if last := s.multi.LastError(spec.Name); last != "" {
			out.State = "offline"
			out.Error = last
		}
		out.Capabilities = s.capabilities("", "unknown", "not probed", shared)
		return out
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
		shared.grammar,
		shared.speech,
		{ID: "spelling", Label: "Spelling", Owner: "browser", State: "fallback", Detail: "nspell RU+EN · this device"},
	}
}

func (s *Server) speechCapability(ctx context.Context) capabilityOut {
	ok, clients, detail := false, 0, "host TTS not configured"
	if s.tts != nil {
		ok, clients, detail = s.tts.status(ctx)
	}
	voice := s.voice != nil && s.voice.available()
	switch {
	case ok && clients > 0:
		return capabilityOut{ID: "speech", Label: "Speech", Owner: "opencode", State: "on", Detail: fmt.Sprintf("host TTS · %d audio client(s)", clients)}
	case voice:
		return capabilityOut{ID: "speech", Label: "Speech", Owner: "nit-gui", State: "on", Detail: s.voice.detail}
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
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}
