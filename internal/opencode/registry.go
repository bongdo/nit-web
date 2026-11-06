package opencode

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var ErrUnknownInstance = errors.New("unknown instance")

var instanceNameRE = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

const clientTTL = 10 * time.Second

type InstanceSpec struct {
	Name         string
	URL          string
	SSH          string
	Dir          string
	Password     string
	PasswordFile string
}

type instance struct {
	spec     InstanceSpec
	mu       sync.Mutex
	client   *Client
	resolved time.Time
	tunnel   io.Closer
	lastErr  string
}

type Registry struct {
	instances   []*instance
	byName      map[string]*instance
	defaultName string
	configErr   string
	ctx         context.Context
	cancel      context.CancelFunc
}

func NewRegistry() *Registry {
	ctx, cancel := context.WithCancel(context.Background())
	r := &Registry{byName: map[string]*instance{}, ctx: ctx, cancel: cancel}
	specs, err := loadInstances()
	if err != nil {
		r.configErr = err.Error()
		slog.Default().Warn("instances config ignored", "error", err)
		specs = nil
	}
	if len(specs) == 0 {
		specs = []InstanceSpec{{Name: "local"}}
	}
	for _, spec := range specs {
		in := &instance{spec: spec}
		r.instances = append(r.instances, in)
		r.byName[spec.Name] = in
	}
	r.defaultName = r.instances[0].spec.Name
	return r
}

func loadInstances() ([]InstanceSpec, error) {
	path := instancesPath()
	if path == "" {
		return nil, nil
	}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read instances config: %w", err)
	}
	var f struct {
		Instances []InstanceSpec `json:"instances"`
	}
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, fmt.Errorf("parse instances config: %w", err)
	}
	seen := make(map[string]bool, len(f.Instances))
	shared := false
	for i := range f.Instances {
		spec := &f.Instances[i]
		if !instanceNameRE.MatchString(spec.Name) {
			return nil, fmt.Errorf("invalid instance name %q", spec.Name)
		}
		if seen[spec.Name] {
			return nil, fmt.Errorf("duplicate instance name %q", spec.Name)
		}
		seen[spec.Name] = true
		if spec.SSH != "" && spec.URL != "" && spec.URL != "auto" {
			return nil, fmt.Errorf("instance %q sets both url and ssh", spec.Name)
		}
		if spec.PasswordFile != "" {
			spec.PasswordFile = expandHome(spec.PasswordFile)
		}
		if spec.Password != "" {
			shared = true
		}
	}
	if shared {
		if info, err := os.Stat(path); err == nil && info.Mode().Perm()&0o077 != 0 {
			slog.Default().Warn("instances config is readable by other users", "path", path)
		}
	}
	return f.Instances, nil
}

func instancesPath() string {
	if v := strings.TrimSpace(os.Getenv("NIT_GUI_INSTANCES")); v != "" {
		return expandHome(v)
	}
	base := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME"))
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "nit-gui", "instances.json")
}

func (r *Registry) Client(ctx context.Context) (*Client, error) {
	return r.ClientFor(ctx, r.defaultName)
}

func (r *Registry) Drop() {
	r.DropFor(r.defaultName)
}

func (r *Registry) ClientFor(ctx context.Context, name string) (*Client, error) {
	in, ok := r.byName[name]
	if !ok {
		return nil, fmt.Errorf("%w: %q", ErrUnknownInstance, name)
	}
	return r.client(ctx, in)
}

func (r *Registry) DropFor(name string) {
	in, ok := r.byName[name]
	if !ok {
		return
	}
	in.mu.Lock()
	defer in.mu.Unlock()
	in.closeTunnel()
	in.client = nil
	in.resolved = time.Time{}
	in.lastErr = ""
}

func (r *Registry) client(ctx context.Context, in *instance) (*Client, error) {
	in.mu.Lock()
	defer in.mu.Unlock()
	if in.client != nil && (in.spec.SSH != "" || time.Since(in.resolved) < clientTTL) {
		return in.client, nil
	}
	ep, tunnel, err := r.endpoint(ctx, in.spec)
	if err != nil {
		in.lastErr = scrub(err.Error(), in.spec)
		return nil, err
	}
	in.closeTunnel()
	in.tunnel = tunnel
	in.client = New(ep)
	in.resolved = time.Now()
	in.lastErr = ""
	return in.client, nil
}

func (r *Registry) endpoint(ctx context.Context, spec InstanceSpec) (Endpoint, io.Closer, error) {
	if spec.SSH != "" {
		return r.connectSSH(ctx, spec)
	}
	return localEndpoint(ctx, spec)
}

func localEndpoint(ctx context.Context, spec InstanceSpec) (Endpoint, io.Closer, error) {
	var ep Endpoint
	explicit := spec.URL != "" && spec.URL != "auto"
	if explicit {
		base, err := normalizeServerURL(spec.URL)
		if err != nil {
			return Endpoint{}, nil, err
		}
		ep.URL = base
	} else {
		var err error
		ep, err = Discover(ctx)
		if err != nil {
			return Endpoint{}, nil, err
		}
	}
	switch {
	case spec.Password != "":
		pw := spec.Password
		ep.Password = pw
		ep.Refresh = func() (string, bool) { return pw, pw != "" }
	case spec.PasswordFile != "":
		pw, err := readPasswordFile(spec.PasswordFile)
		if err != nil {
			return Endpoint{}, nil, fmt.Errorf("instance %q: read password file: %w", spec.Name, err)
		}
		ep.Password = pw
		ep.Refresh = passwordFileRefresh(spec.PasswordFile)
	case isLoopback(ep.URL):
		if ep.Password == "" {
			ep.Password = ReadPassword()
		}
		ep.Refresh = func() (string, bool) {
			pw := ReadPassword()
			return pw, pw != ""
		}
	case explicit:
		return Endpoint{}, nil, fmt.Errorf("instance %q: set passwordFile for a remote URL", spec.Name)
	}
	return ep, nil, nil
}

func (r *Registry) connectSSH(ctx context.Context, spec InstanceSpec) (Endpoint, io.Closer, error) {
	host := spec.SSH
	statusCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(statusCtx, "ssh", host, "opencode service status").Output()
	if err != nil {
		return Endpoint{}, nil, fmt.Errorf("ssh %s: opencode service status: %w", host, err)
	}
	remote, err := parseServiceURL(string(out))
	if err != nil {
		return Endpoint{}, nil, err
	}
	remoteURL, err := normalizeServerURL(remote)
	if err != nil {
		return Endpoint{}, nil, fmt.Errorf("ssh %s: bad service URL %q", host, remote)
	}
	u, err := url.Parse(remoteURL)
	if err != nil {
		return Endpoint{}, nil, fmt.Errorf("ssh %s: bad service URL %q", host, remote)
	}
	port := u.Port()
	if _, err := strconv.Atoi(port); err != nil {
		return Endpoint{}, nil, fmt.Errorf("ssh %s: bad port %q", host, port)
	}

	var password string
	var refresh func() (string, bool)
	switch {
	case spec.Password != "":
		pw := spec.Password
		password = pw
		refresh = func() (string, bool) { return pw, pw != "" }
	case spec.PasswordFile != "":
		pw, err := readPasswordFile(spec.PasswordFile)
		if err != nil {
			return Endpoint{}, nil, fmt.Errorf("instance %q: read password file: %w", spec.Name, err)
		}
		password = pw
		refresh = passwordFileRefresh(spec.PasswordFile)
	default:
		pw, err := readSSHPassword(ctx, host)
		if err != nil {
			return Endpoint{}, nil, err
		}
		password = pw
		refresh = func() (string, bool) {
			c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			pw, err := readSSHPassword(c, host)
			return pw, err == nil && pw != ""
		}
	}

	local, err := freePort()
	if err != nil {
		return Endpoint{}, nil, err
	}
	t := &sshTunnel{}
	t.cmd = exec.CommandContext(r.ctx, "ssh", "-N", "-o", "ExitOnForwardFailure=yes",
		"-L", fmt.Sprintf("127.0.0.1:%d:127.0.0.1:%s", local, port), host)
	if err := t.cmd.Start(); err != nil {
		return Endpoint{}, nil, fmt.Errorf("ssh %s: tunnel: %w", host, err)
	}
	if err := waitPort(ctx, local, 10*time.Second); err != nil {
		_ = t.Close()
		return Endpoint{}, nil, fmt.Errorf("ssh %s: tunnel did not open: %w", host, err)
	}
	ep := Endpoint{URL: fmt.Sprintf("http://127.0.0.1:%d", local), Password: password, Refresh: refresh}
	return ep, t, nil
}

func readSSHPassword(ctx context.Context, host string) (string, error) {
	out, err := exec.CommandContext(ctx, "ssh", host, `cat "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/service.json"`).Output()
	if err != nil {
		return "", fmt.Errorf("ssh %s: read service.json: %w", host, err)
	}
	var v struct {
		Password string `json:"password"`
	}
	if json.Unmarshal(out, &v) != nil || v.Password == "" {
		return "", fmt.Errorf("ssh %s: no password in service.json", host)
	}
	return v.Password, nil
}

func (r *Registry) Instances() []InstanceSpec {
	out := make([]InstanceSpec, 0, len(r.instances))
	for _, in := range r.instances {
		out = append(out, in.spec)
	}
	return out
}

func (r *Registry) DefaultInstance() string {
	return r.defaultName
}

func (r *Registry) ConfigError() string {
	return r.configErr
}

func (r *Registry) ConfigPath() string {
	return instancesPath()
}

func (r *Registry) Connected(name string) bool {
	in, ok := r.byName[name]
	if !ok {
		return false
	}
	in.mu.Lock()
	defer in.mu.Unlock()
	if in.client == nil {
		return false
	}
	return in.spec.SSH != "" || time.Since(in.resolved) < clientTTL
}

func (r *Registry) LastError(name string) string {
	in, ok := r.byName[name]
	if !ok {
		return ""
	}
	in.mu.Lock()
	defer in.mu.Unlock()
	return in.lastErr
}

func (r *Registry) HasInstance(name string) bool {
	_, ok := r.byName[name]
	return ok
}

func (r *Registry) Spec(name string) (InstanceSpec, bool) {
	in, ok := r.byName[name]
	if !ok {
		return InstanceSpec{}, false
	}
	return in.spec, true
}

func (r *Registry) Transport(name string) string {
	in, ok := r.byName[name]
	if !ok {
		return ""
	}
	return in.spec.transport()
}

func (r *Registry) Detail(name string) string {
	in, ok := r.byName[name]
	if !ok {
		return ""
	}
	return in.spec.detail()
}

func (r *Registry) Close() {
	r.cancel()
	for _, in := range r.instances {
		in.mu.Lock()
		in.closeTunnel()
		in.client = nil
		in.resolved = time.Time{}
		in.mu.Unlock()
	}
}

func (in *instance) closeTunnel() {
	if in.tunnel != nil {
		_ = in.tunnel.Close()
		in.tunnel = nil
	}
}

func (s InstanceSpec) transport() string {
	switch {
	case s.SSH != "":
		return "ssh"
	case s.URL == "" || s.URL == "auto":
		return "local"
	default:
		return "url"
	}
}

func (s InstanceSpec) detail() string {
	switch {
	case s.SSH != "":
		return "ssh " + s.SSH
	case s.URL == "" || s.URL == "auto":
		return "local"
	default:
		if u, err := normalizeServerURL(s.URL); err == nil {
			return u
		}
		return "url (invalid)"
	}
}

func readPasswordFile(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}

func passwordFileRefresh(path string) func() (string, bool) {
	return func() (string, bool) {
		pw, err := readPasswordFile(path)
		return pw, err == nil && pw != ""
	}
}

func isLoopback(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := u.Hostname()
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func parseServiceURL(out string) (string, error) {
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "http://") || strings.HasPrefix(line, "https://") {
			return line, nil
		}
	}
	return "", fmt.Errorf("%w: unexpected `opencode service status` output", ErrNoService)
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func waitPort(ctx context.Context, port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	for time.Now().Before(deadline) {
		c, err := net.DialTimeout("tcp", addr, 200*time.Millisecond)
		if err == nil {
			_ = c.Close()
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return errors.New("timeout")
}

type sshTunnel struct {
	cmd *exec.Cmd
}

func (t *sshTunnel) Close() error {
	if t == nil || t.cmd == nil || t.cmd.Process == nil {
		return nil
	}
	err := t.cmd.Process.Kill()
	_, _ = t.cmd.Process.Wait()
	return err
}

func expandHome(p string) string {
	if strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, p[2:])
		}
	}
	return p
}

func scrub(msg string, spec InstanceSpec) string {
	if msg != "" && spec.Password != "" {
		msg = strings.ReplaceAll(msg, spec.Password, redactedValue)
	}
	return msg
}
