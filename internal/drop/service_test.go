package drop

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestLoadServiceConfig(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "Containerfile"), "FROM scratch\n")
	cfg, err := LoadServiceConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Dir != dir || cfg.Port != 3000 || cfg.Health != "/" || cfg.Image != "" {
		t.Fatalf("containerfile config = %+v", cfg)
	}

	writeFile(t, filepath.Join(dir, "drop.json"), `{"port": 8080, "health": "/healthz", "cmd": ["python", "app.py"]}`)
	cfg, err = LoadServiceConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 8080 || cfg.Health != "/healthz" || len(cfg.Cmd) != 2 {
		t.Fatalf("drop.json config = %+v", cfg)
	}

	imageDir := t.TempDir()
	writeFile(t, filepath.Join(imageDir, "drop.json"), `{"image": "python:3.13-slim", "cmd": ["python", "-m", "http.server"]}`)
	cfg, err = LoadServiceConfig(imageDir)
	if err != nil || cfg.Image != "python:3.13-slim" {
		t.Fatalf("image config = %+v, %v", cfg, err)
	}

	empty := t.TempDir()
	if _, err := LoadServiceConfig(empty); err == nil || !strings.Contains(err.Error(), "Containerfile") {
		t.Fatalf("empty dir error = %v", err)
	}

	writeFile(t, filepath.Join(imageDir, "Containerfile"), "FROM scratch\n")
	if _, err := LoadServiceConfig(imageDir); err == nil || !strings.Contains(err.Error(), "not both") {
		t.Fatalf("mixed contract error = %v", err)
	}

	bad := t.TempDir()
	writeFile(t, filepath.Join(bad, "Containerfile"), "FROM scratch\n")
	writeFile(t, filepath.Join(bad, "drop.json"), `{"port": 70000}`)
	if _, err := LoadServiceConfig(bad); err == nil {
		t.Fatal("accepted bad port")
	}
	writeFile(t, filepath.Join(bad, "drop.json"), `{"prot": 3000}`)
	if _, err := LoadServiceConfig(bad); err == nil {
		t.Fatal("accepted an unknown drop.json field")
	}
	writeFile(t, filepath.Join(bad, "drop.json"), `{"health": "healthz"}`)
	if _, err := LoadServiceConfig(bad); err == nil {
		t.Fatal("accepted a relative health path")
	}
}

func TestCreateServiceAndDeleteHook(t *testing.T) {
	store := testStore(t)
	var deleted []string
	store.SetDeleteHook(func(entry Entry) {
		if entry.Kind == "service" {
			deleted = append(deleted, entry.ID)
		}
	})
	dir := t.TempDir()
	entry, err := store.CreateService(dir, "app", PublishOptions{Slug: "my-app", Public: true, TTL: 2 * time.Hour}, Service{
		Dir: dir, Image: "example:latest", Port: 3000, Health: "/healthz",
	})
	if err != nil {
		t.Fatal(err)
	}
	if entry.Kind != "service" || entry.Slug != "my-app" || !entry.Public || entry.Expires == nil {
		t.Fatalf("entry = %+v", entry)
	}
	if entry.Service == nil || entry.Service.Container != "drop-my-app" || entry.Service.Port != 3000 || entry.Service.Health != "/healthz" {
		t.Fatalf("service = %+v", entry.Service)
	}
	if _, err := store.Get("my-app"); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(entry.ID); err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 1 || deleted[0] != entry.ID {
		t.Fatalf("delete hook = %v", deleted)
	}
}

func TestServiceProxyPathAndHeaders(t *testing.T) {
	store := testStore(t)
	dir := t.TempDir()
	entry, err := store.CreateService(dir, "app", PublishOptions{Slug: "my-app-1", Public: true}, Service{
		Dir: dir, Image: "example:latest", Port: 3000, Health: "/", HostPort: 9999,
	})
	if err != nil {
		t.Fatal(err)
	}
	var seen *http.Request
	var seenBody string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.Clone(context.Background())
		body, _ := io.ReadAll(r.Body)
		seenBody = string(body)
		w.Header().Add("Set-Cookie", "app=1; Path=/; Domain=example.com; HttpOnly")
		w.Header().Add("Set-Cookie", "nit_gate=stolen; Path=/")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("upstream"))
	}))
	defer upstream.Close()
	if _, err := store.SetSlug(entry.ID, "canonical"); err != nil {
		t.Fatal(err)
	}
	_, portText, _ := net.SplitHostPort(strings.TrimPrefix(upstream.URL, "http://"))
	port, _ := strconv.Atoi(portText)
	services := NewServices(store)
	services.remember(entry.ID, port, entry.Service.Revision)

	handler := NewPublic(store, func(*http.Request) bool { return false }, nil, "/nit", services)
	server := httptest.NewServer(handler)
	defer server.Close()

	req, _ := http.NewRequest(http.MethodPost, server.URL+"/d/my-app-1/deep/path?x=1", strings.NewReader("payload"))
	req.Host = "public.example"
	req.Header.Set("Cookie", "a=b; nit_gate=secret")
	req.Header.Set("Authorization", "Bearer secret")
	req.Header.Set("X-Nit-Instance", "private")
	req.Header.Set("X-Forwarded-Proto", "https")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || string(body) != "upstream" {
		t.Fatalf("proxy = %d %q", resp.StatusCode, body)
	}
	if seen == nil {
		t.Fatal("upstream was not reached")
	}
	if seen.URL.Path != "/deep/path" || seen.URL.RawQuery != "x=1" || seenBody != "payload" {
		t.Fatalf("upstream request = %s %q", seen.URL.RequestURI(), seenBody)
	}
	if seen.Host != "127.0.0.1:"+portText {
		t.Fatalf("upstream host = %q", seen.Host)
	}
	if seen.Header.Get("X-Forwarded-Prefix") != "/nit/d/my-app-1" {
		t.Fatalf("forwarded prefix = %q", seen.Header.Get("X-Forwarded-Prefix"))
	}
	if seen.Header.Get("X-Forwarded-Host") != "public.example" || seen.Header.Get("X-Forwarded-Proto") != "https" {
		t.Fatalf("forwarded host/proto = %q %q", seen.Header.Get("X-Forwarded-Host"), seen.Header.Get("X-Forwarded-Proto"))
	}
	if strings.Contains(seen.Header.Get("Cookie"), "nit_gate") || !strings.Contains(seen.Header.Get("Cookie"), "a=b") {
		t.Fatalf("upstream cookie = %q", seen.Header.Get("Cookie"))
	}
	if seen.Header.Get("Authorization") != "" || seen.Header.Get("X-Nit-Instance") != "" {
		t.Fatalf("private headers leaked: %+v", seen.Header)
	}
	cookies := resp.Header.Values("Set-Cookie")
	if len(cookies) != 1 || !strings.Contains(cookies[0], "Path=/nit/d/my-app-1/") || strings.Contains(cookies[0], "Domain=") {
		t.Fatalf("response cookies = %v", cookies)
	}
}

func TestPrivateServiceDoesNotReveal(t *testing.T) {
	store := testStore(t)
	dir := t.TempDir()
	entry, err := store.CreateService(dir, "app", PublishOptions{}, Service{
		Dir: dir, Image: "example:latest", Port: 3000, Health: "/",
	})
	if err != nil {
		t.Fatal(err)
	}
	services := NewServices(store)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("secret"))
	}))
	defer upstream.Close()
	_, portText, _ := net.SplitHostPort(strings.TrimPrefix(upstream.URL, "http://"))
	port, _ := strconv.Atoi(portText)
	services.remember(entry.ID, port, entry.Service.Revision)

	anonymous := httptest.NewServer(NewPublic(store, func(*http.Request) bool { return false }, nil, "", services))
	defer anonymous.Close()
	resp, err := http.Get(anonymous.URL + "/d/" + entry.Slug + "/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("anonymous private service = %d", resp.StatusCode)
	}

	authenticated := httptest.NewServer(NewPublic(store, func(*http.Request) bool { return true }, nil, "", services))
	defer authenticated.Close()
	resp, err = http.Get(authenticated.URL + "/d/" + entry.Slug + "/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || string(body) != "secret" {
		t.Fatalf("authenticated private service = %d %q", resp.StatusCode, body)
	}
}

type fakePodman struct {
	t        *testing.T
	mu       sync.Mutex
	running  map[string]bool
	listener map[string]net.Listener
	port     map[string]int
	id       string
}

func newFakePodman(t *testing.T) *fakePodman {
	return &fakePodman{t: t, running: map[string]bool{}, listener: map[string]net.Listener{}, port: map[string]int{}}
}

func (f *fakePodman) run(_ context.Context, args ...string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	switch args[0] {
	case "build", "rmi":
		return nil, nil
	case "image":
		return nil, nil
	case "container":
		name := args[len(args)-1]
		if _, ok := f.running[name]; !ok {
			return nil, exitCodeOne(f.t)
		}
		return nil, nil
	case "inspect":
		name := args[len(args)-1]
		value := "true"
		if args[2] == `{{index .Config.Labels "nit.drop.id"}}` {
			value = f.id
		} else if !f.running[name] {
			value = "false"
		}
		return []byte(value), nil
	case "run":
		name := argValue(args, "--name")
		publish := argValue(args, "--publish")
		parts := strings.Split(publish, ":")
		hostPort, _ := strconv.Atoi(parts[1])
		f.startListener(name, hostPort)
		f.running[name] = true
		f.port[name] = hostPort
		return []byte("container-id"), nil
	case "stop":
		name := args[len(args)-1]
		f.stopListener(name)
		f.running[name] = false
		return nil, nil
	case "start":
		name := args[len(args)-1]
		if err := f.startListener(name, f.port[name]); err != nil {
			return nil, err
		}
		f.running[name] = true
		return nil, nil
	case "rm":
		name := args[len(args)-1]
		f.stopListener(name)
		delete(f.running, name)
		delete(f.port, name)
		return nil, nil
	case "port":
		name := args[1]
		return []byte("127.0.0.1:" + strconv.Itoa(f.port[name])), nil
	case "ps":
		return nil, nil
	}
	return nil, nil
}

func (f *fakePodman) startListener(name string, port int) error {
	f.stopListener(name)
	listener, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		return err
	}
	f.listener[name] = listener
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})}
	go func() { _ = server.Serve(listener) }()
	return nil
}

func (f *fakePodman) stopListener(name string) {
	if listener := f.listener[name]; listener != nil {
		_ = listener.Close()
		delete(f.listener, name)
	}
}

func argValue(args []string, name string) string {
	for index := 0; index < len(args)-1; index++ {
		if args[index] == name {
			return args[index+1]
		}
	}
	return ""
}

func exitCodeOne(t *testing.T) error {
	t.Helper()
	return exec.Command("false").Run()
}

func TestServiceLifecycleWithFakePodman(t *testing.T) {
	store := testStore(t)
	fake := newFakePodman(t)
	services := NewServices(store)
	services.exec = fake.run

	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "Containerfile"), "FROM scratch\n")
	writeFile(t, filepath.Join(dir, "drop.json"), `{"port": 3000, "health": "/"}`)
	cfg, err := LoadServiceConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	entry, err := services.Create(ctx, dir, PublishOptions{Slug: "fake"}, cfg)
	if err != nil {
		t.Fatal(err)
	}
	fake.id = entry.ID
	if entry.Service.Status != "running" || entry.Service.HostPort == 0 {
		t.Fatalf("created service = %+v", entry.Service)
	}
	if port, err := services.Port(entry); err != nil || port != entry.Service.HostPort {
		t.Fatalf("runtime port = %d, %v", port, err)
	}

	entry, err = services.Stop(ctx, entry)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Service.Status != "stopped" || !entry.Service.Stopped {
		t.Fatalf("stopped service = %+v", entry.Service)
	}

	entry, err = services.Start(ctx, entry)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Service.Status != "running" || entry.Service.Stopped {
		t.Fatalf("started service = %+v", entry.Service)
	}

	entry, err = services.Restart(ctx, entry)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Service.Status != "running" {
		t.Fatalf("restarted service = %+v", entry.Service)
	}

	if err := store.Delete(entry.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(entry.ID); err == nil {
		t.Fatal("service entry survived delete")
	}
}
