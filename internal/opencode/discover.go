package opencode

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

var ErrNoService = errors.New("opencode service not found")

type Endpoint struct {
	URL      string
	Password string
	Refresh  func() (string, bool)
}

func Discover(ctx context.Context) (Endpoint, error) {
	var raw string
	for _, key := range []string{"NIT_SERVER", "OPENCODE_SERVER", "OPENCODE_URL"} {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			raw = v
			break
		}
	}
	if raw == "" {
		u, err := serviceURL(ctx)
		if err != nil {
			return Endpoint{}, err
		}
		raw = u
	}
	base, err := normalizeServerURL(raw)
	if err != nil {
		return Endpoint{}, err
	}
	password := ReadPassword()
	if password == "" {
		return Endpoint{}, fmt.Errorf("%w: no password in service.json", ErrNoService)
	}
	return Endpoint{URL: base, Password: password}, nil
}

func serviceURL(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "opencode", "service", "status").Output()
	if err != nil {
		return "", fmt.Errorf("%w: run `opencode service start`", ErrNoService)
	}
	return parseServiceURL(string(out))
}

func normalizeServerURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", fmt.Errorf("%w: invalid server URL", ErrNoService)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("%w: unsupported server scheme", ErrNoService)
	}
	u.User = nil
	u.RawQuery = ""
	u.Fragment = ""
	host := u.Hostname()
	if host == "0.0.0.0" {
		host = "127.0.0.1"
	} else if host == "::" {
		host = "::1"
	}
	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	u.Host = net.JoinHostPort(host, port)
	u.Path = strings.TrimRight(u.Path, "/")
	return strings.TrimRight(u.String(), "/"), nil
}

func configDir() string {
	if v := os.Getenv("XDG_CONFIG_HOME"); v != "" {
		return filepath.Join(v, "opencode")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".config", "opencode")
}

func ReadPassword() string {
	dir := configDir()
	if dir == "" {
		return ""
	}
	b, err := os.ReadFile(filepath.Join(dir, "service.json"))
	if err != nil {
		return ""
	}
	var v struct {
		Password string `json:"password"`
	}
	if json.Unmarshal(b, &v) != nil {
		return ""
	}
	return v.Password
}
