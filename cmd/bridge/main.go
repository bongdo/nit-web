package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"nitgui/internal/gate"
)

const (
	protocol     = 1
	version      = "0.1.0"
	helloTimeout = 15 * time.Second
	idleTimeout  = 45 * time.Second
	pingInterval = 20 * time.Second
	chunkSize    = 256 * 1024
	maxParallel  = 32
	frameText    = 1
)

type target struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

var defaultTargets = []target{
	{Name: "pero", URL: "http://127.0.0.1:7789"},
	{Name: "term", URL: "http://127.0.0.1:7795"},
}

type config struct {
	Server   string   `json:"server"`
	Name     string   `json:"name"`
	Token    string   `json:"token"`
	OpenCode string   `json:"opencode"`
	Targets  []target `json:"targets"`
}

func main() {
	configPath := flag.String("config", "", "path to config.json")
	once := flag.Bool("once", false, "connect, report state and exit")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	path := *configPath
	if path == "" {
		path = defaultConfigPath()
	}
	cfg, err := loadConfig(path)
	if err != nil {
		log.Error("bridge config", "path", path, "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	delay := time.Second
	for {
		connected, err := run(ctx, cfg, *once, log)
		if *once {
			if err != nil {
				log.Error("bridge", "error", err)
				os.Exit(1)
			}
			return
		}
		if ctx.Err() != nil {
			return
		}
		if connected {
			delay = time.Second
		}
		if err != nil {
			log.Warn("bridge disconnected", "error", err)
		}
		wait := jitter(delay)
		log.Info("reconnect", "in", wait.Round(time.Millisecond))
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		if delay < time.Minute {
			delay *= 2
			if delay > time.Minute {
				delay = time.Minute
			}
		}
	}
}

func defaultConfigPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "config.json"
	}
	return filepath.Join(dir, "nit-bridge", "config.json")
}

func loadConfig(path string) (config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return config{}, err
	}
	var cfg config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return config{}, err
	}
	if cfg.Server == "" || cfg.Name == "" || cfg.Token == "" || cfg.OpenCode == "" {
		return config{}, errors.New("server, name, token and opencode are required")
	}
	if !validName(cfg.Name) {
		return config{}, errors.New("name: 2-32 characters of a-z, 0-9, dash or underscore")
	}
	return cfg, nil
}

func validName(name string) bool {
	if len(name) < 2 || len(name) > 32 {
		return false
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-', r == '_':
		default:
			return false
		}
	}
	return true
}

func (c config) target(name string) (string, bool) {
	for _, item := range c.Targets {
		if item.Name == name {
			return strings.TrimSpace(item.URL), item.URL != ""
		}
	}
	if name == "opencode" && c.OpenCode != "" {
		return c.OpenCode, true
	}
	for _, item := range defaultTargets {
		if item.Name == name {
			return item.URL, true
		}
	}
	return "", false
}

func (c config) state(openCodeVersion string) gate.AgentFrame {
	targets := make([]gate.AgentTarget, 0, len(c.Targets)+3)
	targets = append(targets, gate.AgentTarget{Name: "opencode", Kind: "http", Detail: c.OpenCode})
	seen := map[string]bool{"opencode": true}
	for _, item := range c.Targets {
		targets = append(targets, gate.AgentTarget{Name: item.Name, Kind: "http", Detail: item.URL})
		seen[item.Name] = true
	}
	for _, item := range defaultTargets {
		if seen[item.Name] {
			continue
		}
		targets = append(targets, gate.AgentTarget{Name: item.Name, Kind: "http", Detail: item.URL})
	}
	return gate.AgentFrame{
		Type:     "state",
		OpenCode: &gate.AgentOpenCode{Version: openCodeVersion, URL: c.OpenCode},
		Targets:  targets,
		Dirs:     []string{},
	}
}

func run(ctx context.Context, cfg config, once bool, log *slog.Logger) (bool, error) {
	dialCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	ws, err := gate.DialWebSocket(dialCtx, cfg.Server, http.Header{"Authorization": {"Bearer " + cfg.Token}})
	cancel()
	if err != nil {
		return false, err
	}
	defer ws.Close()

	hello := gate.AgentFrame{Type: "hello", Name: cfg.Name, Protocol: protocol, Version: version}
	if err := ws.WriteJSON(hello); err != nil {
		return false, err
	}
	ws.SetReadDeadline(time.Now().Add(helloTimeout))
	op, data, err := ws.ReadMessage()
	if err != nil {
		return false, err
	}
	var welcome gate.AgentFrame
	if op != frameText || json.Unmarshal(data, &welcome) != nil || welcome.Type != "welcome" {
		return false, errors.New("gate did not send welcome")
	}
	log.Info("connected", "machine", cfg.Name, "session", welcome.Session)

	password := openCodePassword()
	client := &http.Client{Transport: &http.Transport{
		Proxy:                 nil,
		MaxIdleConnsPerHost:   maxParallel,
		ResponseHeaderTimeout: 60 * time.Second,
		IdleConnTimeout:       90 * time.Second,
	}}
	defer client.CloseIdleConnections()

	probeCtx, probeCancel := context.WithTimeout(ctx, 5*time.Second)
	openCodeVersion := probeVersion(probeCtx, client, cfg.OpenCode, password)
	probeCancel()
	if err := ws.WriteJSON(cfg.state(openCodeVersion)); err != nil {
		return false, err
	}
	if once {
		log.Info("state reported", "opencode", openCodeVersion)
		return true, nil
	}

	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			_ = ws.WriteClose(1001, "shutting down")
			_ = ws.Close()
		case <-done:
		}
	}()
	go heartbeat(ws, done)

	ws.SetIdleTimeout(idleTimeout)
	slots := make(chan struct{}, maxParallel)
	for {
		op, data, err := ws.ReadMessage()
		if err != nil {
			return true, err
		}
		if op != frameText {
			continue
		}
		var frame gate.AgentFrame
		if json.Unmarshal(data, &frame) != nil || frame.Type != "req" {
			continue
		}
		select {
		case slots <- struct{}{}:
			go func(frame gate.AgentFrame) {
				defer func() { <-slots }()
				serve(ctx, client, cfg, ws, frame, password, log)
			}(frame)
		default:
			_ = ws.WriteJSON(gate.AgentFrame{Type: "res", ID: frame.ID, Status: http.StatusTooManyRequests, Error: "bridge is busy"})
			_ = ws.WriteJSON(gate.AgentFrame{Type: "end", ID: frame.ID})
		}
	}
}

func heartbeat(ws *gate.WSConn, done <-chan struct{}) {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			if err := ws.WritePing(); err != nil {
				_ = ws.Close()
				return
			}
		}
	}
}

func serve(ctx context.Context, client *http.Client, cfg config, ws *gate.WSConn, frame gate.AgentFrame, password string, log *slog.Logger) {
	base, ok := cfg.target(frame.Target)
	if !ok {
		replyError(ws, frame.ID, http.StatusBadGateway, "unknown target")
		return
	}
	if !strings.HasPrefix(frame.Path, "/") || strings.HasPrefix(frame.Path, "//") {
		replyError(ws, frame.ID, http.StatusBadGateway, "bad request path")
		return
	}
	var body []byte
	if frame.Body != "" {
		decoded, err := base64.StdEncoding.DecodeString(frame.Body)
		if err != nil {
			replyError(ws, frame.ID, http.StatusBadGateway, "bad request body")
			return
		}
		body = decoded
	}
	method := frame.Method
	if method == "" {
		method = http.MethodGet
	}
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(base, "/")+frame.Path, bytes.NewReader(body))
	if err != nil {
		replyError(ws, frame.ID, http.StatusBadGateway, err.Error())
		return
	}
	for name, values := range frame.Headers {
		if skipHeader(name) {
			continue
		}
		for _, value := range values {
			request.Header.Add(name, value)
		}
	}
	if frame.Target == "opencode" && password != "" {
		request.SetBasicAuth("opencode", password)
	}
	start := time.Now()
	response, err := client.Do(request)
	if err != nil {
		log.Warn("local request failed", "target", frame.Target, "path", frame.Path, "error", err)
		replyError(ws, frame.ID, http.StatusBadGateway, err.Error())
		return
	}
	defer response.Body.Close()
	if err := ws.WriteJSON(gate.AgentFrame{Type: "res", ID: frame.ID, Status: response.StatusCode, Headers: response.Header}); err != nil {
		return
	}
	buf := make([]byte, chunkSize)
	for {
		n, err := response.Body.Read(buf)
		if n > 0 {
			chunk := gate.AgentFrame{Type: "chunk", ID: frame.ID, Body: base64.StdEncoding.EncodeToString(buf[:n])}
			if writeErr := ws.WriteJSON(chunk); writeErr != nil {
				return
			}
		}
		if err != nil {
			break
		}
	}
	_ = ws.WriteJSON(gate.AgentFrame{Type: "end", ID: frame.ID})
	log.Debug("local request", "target", frame.Target, "method", method, "path", frame.Path, "status", response.StatusCode, "took", time.Since(start).Round(time.Millisecond))
}

func replyError(ws *gate.WSConn, id string, status int, message string) {
	_ = ws.WriteJSON(gate.AgentFrame{Type: "res", ID: id, Status: status, Error: message})
	_ = ws.WriteJSON(gate.AgentFrame{Type: "end", ID: id})
}

func skipHeader(name string) bool {
	switch strings.ToLower(name) {
	case "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
		"proxy-connection", "te", "trailer", "transfer-encoding", "upgrade",
		"content-length", "host":
		return true
	}
	return false
}

func probeVersion(ctx context.Context, client *http.Client, base string, password string) string {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(base, "/")+"/api/info", nil)
	if err != nil {
		return ""
	}
	if password != "" {
		request.SetBasicAuth("opencode", password)
	}
	response, err := client.Do(request)
	if err != nil {
		return ""
	}
	defer response.Body.Close()
	var info struct {
		Version string `json:"version"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1<<16)).Decode(&info) != nil {
		return ""
	}
	return info.Version
}

func openCodePassword() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(dir, "opencode", "service.json"))
	if err != nil {
		return ""
	}
	var file struct {
		Password string `json:"password"`
	}
	if json.Unmarshal(data, &file) != nil {
		return ""
	}
	return file.Password
}

func jitter(d time.Duration) time.Duration {
	spread := float64(d) * 0.2
	return time.Duration(float64(d) + (rand.Float64()*2-1)*spread)
}

func init() {
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "usage: nit-bridge [--config path] [--once]\n")
		flag.PrintDefaults()
	}
}
