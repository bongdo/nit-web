package drop

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultServicePort    = 3000
	serviceHealthTimeout  = 60 * time.Second
	serviceBuildTimeout   = 10 * time.Minute
	serviceCommandTimeout = 5 * time.Minute
	serviceStopTimeout    = 30 * time.Second
	serviceTailLimit      = 8 << 10
)

type serviceFile struct {
	Image  string   `json:"image"`
	Port   int      `json:"port"`
	Health string   `json:"health"`
	Cmd    []string `json:"cmd"`
}

type serviceRuntime struct {
	port     int
	revision int64
}

type Services struct {
	store    *Store
	podman   string
	basePath string
	log      *slog.Logger
	client   *http.Client

	mu      sync.Mutex
	runtime map[string]serviceRuntime
	exec    func(context.Context, ...string) ([]byte, error)
}

func NewServices(store *Store) *Services {
	services := &Services{
		store:    store,
		podman:   envOr("NIT_DROP_PODMAN", "podman"),
		basePath: strings.TrimRight(os.Getenv("NIT_DROP_BASE_PATH"), "/"),
		log:      slog.Default(),
		runtime:  map[string]serviceRuntime{},
		client: &http.Client{
			Timeout: 3 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
	services.exec = services.podmanExec
	store.SetDeleteHook(services.removeEntry)
	return services
}

func (s *Services) SetBasePath(path string) {
	s.basePath = strings.TrimRight(path, "/")
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func LoadServiceConfig(dir string) (Service, error) {
	if strings.TrimSpace(dir) == "" {
		return Service{}, errors.New("drop service needs a directory")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return Service{}, err
	}
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		abs = resolved
	}
	info, err := os.Stat(abs)
	if err != nil {
		return Service{}, err
	}
	if !info.IsDir() {
		return Service{}, fmt.Errorf("%s is not a directory", abs)
	}
	if strings.ContainsRune(abs, ':') {
		return Service{}, fmt.Errorf("%s: a colon in the service directory is not supported by podman volumes", abs)
	}
	if abs == string(filepath.Separator) {
		return Service{}, errors.New("refusing to use the filesystem root as a service directory")
	}
	if home, err := os.UserHomeDir(); err == nil && abs == filepath.Clean(home) {
		return Service{}, errors.New("refusing to use the home directory as a service directory")
	}

	service := Service{Dir: abs, Port: defaultServicePort, Health: "/"}
	configPath := filepath.Join(abs, "drop.json")
	if data, err := os.ReadFile(configPath); err == nil {
		if len(data) > 64<<10 {
			return Service{}, fmt.Errorf("%s is too large", configPath)
		}
		var file serviceFile
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&file); err != nil {
			return Service{}, fmt.Errorf("%s: %w", configPath, err)
		}
		service.Image = strings.TrimSpace(file.Image)
		if file.Port != 0 {
			service.Port = file.Port
		}
		if strings.TrimSpace(file.Health) != "" {
			service.Health = strings.TrimSpace(file.Health)
		}
		service.Cmd = file.Cmd
	} else if !errors.Is(err, os.ErrNotExist) {
		return Service{}, err
	}

	containerfile := serviceContainerfile(abs)
	if containerfile != "" && service.Image != "" {
		return Service{}, fmt.Errorf("%s: use either a Containerfile/Dockerfile or drop.json image, not both", abs)
	}
	if containerfile == "" && service.Image == "" {
		return Service{}, fmt.Errorf("%s needs a Containerfile/Dockerfile or drop.json with \"image\"", abs)
	}
	if service.Port < 1 || service.Port > 65535 {
		return Service{}, fmt.Errorf("%s: invalid port %d", configPath, service.Port)
	}
	if !strings.HasPrefix(service.Health, "/") || strings.ContainsAny(service.Health, "\r\n") {
		return Service{}, fmt.Errorf("%s: health must be an absolute path", configPath)
	}
	if len(service.Cmd) > 64 {
		return Service{}, fmt.Errorf("%s: too many cmd arguments", configPath)
	}
	for _, arg := range service.Cmd {
		if strings.TrimSpace(arg) == "" || strings.ContainsRune(arg, 0) || len(arg) > 4096 {
			return Service{}, fmt.Errorf("%s: invalid cmd argument", configPath)
		}
	}
	return service, nil
}

func serviceContainerfile(dir string) string {
	for _, name := range []string{"Containerfile", "Dockerfile"} {
		path := filepath.Join(dir, name)
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
			return path
		}
	}
	return ""
}

func containerName(slug string) string {
	return "drop-" + slug
}

func localImage(id string) string {
	return "localhost/drop-" + id + ":latest"
}

func managedImage(image string) bool {
	return strings.HasPrefix(image, "localhost/drop-")
}

func (s *Services) Create(ctx context.Context, dir string, opts PublishOptions, cfg Service) (Entry, error) {
	if strings.HasPrefix(filepath.Clean(dir), s.store.Root()+string(filepath.Separator)) ||
		filepath.Clean(dir) == s.store.Root() {
		return Entry{}, errors.New("refusing to use the drop store as a service directory")
	}
	entry, err := s.store.CreateService(cfg.Dir, "", opts, cfg)
	if err != nil {
		return Entry{}, err
	}
	if err := s.build(ctx, &entry, true); err != nil {
		_ = s.store.Delete(entry.ID)
		return Entry{}, err
	}
	if err := s.run(ctx, &entry); err != nil {
		tail := s.logsTail(ctx, entry, 30)
		_ = s.store.Delete(entry.ID)
		if tail != "" {
			return Entry{}, fmt.Errorf("%w\n%s", err, tail)
		}
		return Entry{}, err
	}
	return entry, nil
}

func (s *Services) build(ctx context.Context, entry *Entry, force bool) error {
	cfg := entry.Service
	if cfg == nil {
		return errors.New("not a service")
	}
	containerfile := serviceContainerfile(cfg.Dir)
	image := cfg.Image
	if containerfile == "" {
		if image == "" {
			return fmt.Errorf("%s needs a Containerfile/Dockerfile or drop.json image", cfg.Dir)
		}
		return nil
	}
	if image == "" {
		image = localImage(entry.ID)
	}
	if !force && s.imageExists(ctx, image) {
		return s.persistImage(entry, image)
	}
	runCtx, cancel := context.WithTimeout(ctx, serviceBuildTimeout)
	defer cancel()
	output, err := s.exec(runCtx, "build", "--file", containerfile, "--tag", image, cfg.Dir)
	if err != nil {
		return fmt.Errorf("podman build failed: %w%s", err, commandTail(output))
	}
	return s.persistImage(entry, image)
}

func (s *Services) persistImage(entry *Entry, image string) error {
	if entry.Service.Image == image {
		return nil
	}
	updated, err := s.store.Update(entry.ID, func(current *Entry) {
		if current.Service != nil {
			current.Service.Image = image
		}
	})
	if err != nil {
		return err
	}
	*entry = updated
	return nil
}

func (s *Services) imageExists(ctx context.Context, image string) bool {
	if image == "" {
		return false
	}
	_, err := s.exec(ctx, "image", "exists", image)
	return err == nil
}

func (s *Services) run(ctx context.Context, entry *Entry) error {
	cfg := entry.Service
	if cfg == nil {
		return errors.New("not a service")
	}
	if strings.TrimSpace(cfg.Image) == "" {
		return errors.New("service image is missing; build it first")
	}
	name := cfg.Container
	if name == "" {
		name = containerName(entry.Slug)
	}
	if exists, owned, err := s.containerState(ctx, name, entry.ID); err != nil {
		return err
	} else if exists {
		if !owned {
			return fmt.Errorf("container %s exists and is not managed by drop", name)
		}
		if err := s.removeContainer(ctx, entry, false); err != nil {
			return err
		}
	}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		port, err := freePort()
		if err != nil {
			return err
		}
		args := s.runArgs(*entry, name, port)
		runCtx, cancel := context.WithTimeout(ctx, serviceCommandTimeout)
		output, err := s.exec(runCtx, args...)
		cancel()
		if err != nil {
			lastErr = fmt.Errorf("podman run failed: %w%s", err, commandTail(output))
			if strings.Contains(strings.ToLower(string(output)), "address already in use") {
				continue
			}
			return lastErr
		}
		if err := s.waitHealthy(ctx, port, cfg.Health); err != nil {
			tail := s.logsTail(ctx, *entry, 30)
			if tail != "" {
				err = fmt.Errorf("%w\n%s", err, tail)
			}
			_ = s.removeContainer(ctx, entry, false)
			s.forget(entry.ID)
			return err
		}
		updated, err := s.persistState(entry, "running", port, false)
		if err == nil {
			s.remember(entry.ID, port, updated.Service.Revision)
		}
		return err
	}
	return lastErr
}

func (s *Services) runArgs(entry Entry, name string, hostPort int) []string {
	cfg := entry.Service
	args := []string{
		"run", "-d",
		"--name", name,
		"--label", "nit.drop.id=" + entry.ID,
		"--label", "nit.drop.slug=" + entry.Slug,
		"--security-opt", "no-new-privileges",
		"--cap-drop", "all",
		"--init",
		"--log-driver", "k8s-file",
		"--log-opt", "max-size=10mb",
		"--publish", fmt.Sprintf("127.0.0.1:%d:%d", hostPort, cfg.Port),
		"--env", "PORT=" + strconv.Itoa(cfg.Port),
		"--env", "HOST=0.0.0.0",
	}
	if s.basePath != "" {
		args = append(args, "--env", "NIT_DROP_BASE_PATH="+s.basePath+"/d/"+entry.Slug+"/")
	}
	if serviceContainerfile(cfg.Dir) == "" {
		args = append(args, "--volume", cfg.Dir+":/app:ro", "--workdir", "/app")
	}
	args = append(args, cfg.Image)
	args = append(args, cfg.Cmd...)
	return args
}

func (s *Services) Start(ctx context.Context, entry Entry) (Entry, error) {
	cfg := entry.Service
	if cfg == nil {
		return entry, errors.New("not a service")
	}
	name := cfg.Container
	if name == "" {
		name = containerName(entry.Slug)
	}
	exists, owned, err := s.containerState(ctx, name, entry.ID)
	if err != nil {
		return entry, err
	}
	if exists {
		if !owned {
			return entry, fmt.Errorf("container %s is not managed by drop", name)
		}
		running, err := s.containerRunning(ctx, name)
		if err != nil {
			return entry, err
		}
		if !running {
			if _, err := s.exec(ctx, "start", name); err != nil {
				return entry, fmt.Errorf("podman start failed: %w", err)
			}
		}
		port, err := s.publishedPort(ctx, name, cfg.Port)
		if err != nil {
			return entry, err
		}
		if err := s.waitHealthy(ctx, port, cfg.Health); err != nil {
			updated, _ := s.persistState(&entry, "failed", port, false)
			return updated, err
		}
		updated, err := s.persistState(&entry, "running", port, false)
		if err == nil {
			s.remember(entry.ID, port, updated.Service.Revision)
		}
		return updated, err
	}
	if err := s.build(ctx, &entry, false); err != nil {
		updated, _ := s.persistState(&entry, "failed", 0, false)
		return updated, err
	}
	if err := s.run(ctx, &entry); err != nil {
		updated, _ := s.persistState(&entry, "failed", 0, false)
		return updated, err
	}
	return entry, nil
}

func (s *Services) Stop(ctx context.Context, entry Entry) (Entry, error) {
	cfg := entry.Service
	if cfg == nil {
		return entry, errors.New("not a service")
	}
	name := cfg.Container
	if name == "" {
		name = containerName(entry.Slug)
	}
	exists, owned, err := s.containerState(ctx, name, entry.ID)
	if err != nil {
		return entry, err
	}
	if exists && owned {
		runCtx, cancel := context.WithTimeout(ctx, serviceStopTimeout)
		defer cancel()
		if _, err := s.exec(runCtx, "stop", "-t", "5", name); err != nil {
			return entry, fmt.Errorf("podman stop failed: %w", err)
		}
	}
	s.forget(entry.ID)
	return s.persistState(&entry, "stopped", 0, true)
}

func (s *Services) Restart(ctx context.Context, entry Entry) (Entry, error) {
	if _, err := s.Stop(ctx, entry); err != nil {
		return entry, err
	}
	entry.Service.Stopped = false
	if err := s.removeContainer(ctx, &entry, false); err != nil {
		return entry, err
	}
	if err := s.build(ctx, &entry, true); err != nil {
		updated, _ := s.persistState(&entry, "failed", 0, false)
		return updated, err
	}
	if err := s.run(ctx, &entry); err != nil {
		updated, _ := s.persistState(&entry, "failed", 0, false)
		return updated, err
	}
	return entry, nil
}

func (s *Services) Remove(ctx context.Context, entry Entry) error {
	if err := s.removeContainer(ctx, &entry, true); err != nil {
		return err
	}
	s.forget(entry.ID)
	return nil
}

func (s *Services) removeEntry(entry Entry) {
	if entry.Kind != "service" || entry.Service == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), serviceStopTimeout)
	defer cancel()
	if err := s.removeContainer(ctx, &entry, true); err != nil {
		s.log.Warn("drop service cleanup failed", "id", entry.ID, "error", err)
	}
	s.forget(entry.ID)
}

func (s *Services) removeContainer(ctx context.Context, entry *Entry, removeImage bool) error {
	cfg := entry.Service
	if cfg == nil {
		return nil
	}
	name := cfg.Container
	if name == "" {
		name = containerName(entry.Slug)
	}
	exists, owned, err := s.containerState(ctx, name, entry.ID)
	if err != nil || !exists {
		return err
	}
	if !owned {
		return fmt.Errorf("container %s is not managed by drop", name)
	}
	runCtx, cancel := context.WithTimeout(ctx, serviceStopTimeout)
	defer cancel()
	_, _ = s.exec(runCtx, "stop", "-t", "2", name)
	if _, err := s.exec(runCtx, "rm", "-f", name); err != nil {
		return fmt.Errorf("podman rm failed: %w", err)
	}
	if removeImage && managedImage(cfg.Image) {
		_, _ = s.exec(runCtx, "rmi", "-f", cfg.Image)
	}
	return nil
}

func (s *Services) Logs(ctx context.Context, entry Entry, follow bool, stdout, stderr io.Writer) error {
	cfg := entry.Service
	if cfg == nil {
		return errors.New("not a service")
	}
	name := cfg.Container
	if name == "" {
		name = containerName(entry.Slug)
	}
	args := []string{"logs", "--tail", "200"}
	if follow {
		args = append(args, "-f")
	}
	args = append(args, name)
	cmd := exec.CommandContext(ctx, s.podman, args...)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("podman logs: %w", err)
	}
	return nil
}

func (s *Services) logsTail(ctx context.Context, entry Entry, lines int) string {
	cfg := entry.Service
	if cfg == nil {
		return ""
	}
	name := cfg.Container
	if name == "" {
		name = containerName(entry.Slug)
	}
	runCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	output, err := s.exec(runCtx, "logs", "--tail", strconv.Itoa(lines), name)
	if err != nil {
		return ""
	}
	text := strings.TrimSpace(string(output))
	if len(text) > 4000 {
		text = text[len(text)-4000:]
	}
	return text
}

func (s *Services) Status(ctx context.Context, entry Entry) string {
	cfg := entry.Service
	if cfg == nil {
		return ""
	}
	name := cfg.Container
	if name == "" {
		name = containerName(entry.Slug)
	}
	exists, owned, err := s.containerState(ctx, name, entry.ID)
	if err != nil || !exists || !owned {
		return "missing"
	}
	running, err := s.containerRunning(ctx, name)
	if err != nil {
		return "unknown"
	}
	if running {
		return "running"
	}
	return "stopped"
}

func (s *Services) Port(entry Entry) (int, error) {
	if entry.Service == nil {
		return 0, errors.New("not a service")
	}
	s.mu.Lock()
	if value, ok := s.runtime[entry.ID]; ok {
		if value.revision == entry.Service.Revision {
			s.mu.Unlock()
			return value.port, nil
		}
		delete(s.runtime, entry.ID)
	}
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	name := entry.Service.Container
	if name == "" {
		name = containerName(entry.Slug)
	}
	exists, owned, err := s.containerState(ctx, name, entry.ID)
	if err != nil {
		return 0, err
	}
	if !exists || !owned {
		return 0, errors.New("service container is not running")
	}
	running, err := s.containerRunning(ctx, name)
	if err != nil {
		return 0, err
	}
	if !running {
		return 0, errors.New("service container is stopped")
	}
	port, err := s.publishedPort(ctx, name, entry.Service.Port)
	if err != nil {
		return 0, err
	}
	s.remember(entry.ID, port, entry.Service.Revision)
	return port, nil
}

func (s *Services) Forget(id string) {
	s.forget(id)
}

func (s *Services) Restore(ctx context.Context) {
	entries, err := s.store.List()
	if err != nil {
		s.log.Warn("drop service restore failed", "error", err)
		return
	}
	known := map[string]struct{}{}
	for _, entry := range entries {
		known[entry.ID] = struct{}{}
		if entry.Kind != "service" || entry.Service == nil {
			continue
		}
		if entry.Service.Stopped {
			_, _ = s.persistState(&entry, "stopped", 0, true)
			continue
		}
		if _, err := s.Start(ctx, entry); err != nil {
			s.log.Warn("drop service restore failed", "id", entry.ID, "slug", entry.Slug, "error", err)
		}
	}
	s.removeOrphans(ctx, known)
}

func (s *Services) removeOrphans(ctx context.Context, known map[string]struct{}) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	output, err := s.exec(ctx, "ps", "-a", "--filter", "label=nit.drop.id", "--format", `{{.Names}}\t{{.Label "nit.drop.id"}}`)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(output), "\n") {
		fields := strings.Split(strings.TrimSpace(line), "\t")
		if len(fields) != 2 || fields[0] == "" || fields[1] == "" {
			continue
		}
		if _, ok := known[fields[1]]; ok {
			continue
		}
		_, _ = s.exec(ctx, "rm", "-f", fields[0])
		s.log.Info("drop removed orphan container", "container", fields[0], "id", fields[1])
	}
}

func (s *Services) persistState(entry *Entry, status string, hostPort int, stopped bool) (Entry, error) {
	updated, err := s.store.Update(entry.ID, func(current *Entry) {
		if current.Service == nil {
			return
		}
		current.Service.Status = status
		current.Service.HostPort = hostPort
		current.Service.Revision = time.Now().UnixNano()
		current.Service.Stopped = stopped
	})
	if err != nil {
		return *entry, err
	}
	*entry = updated
	return updated, nil
}

func (s *Services) remember(id string, port int, revision int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.runtime[id] = serviceRuntime{port: port, revision: revision}
}

func (s *Services) forget(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.runtime, id)
}

func (s *Services) containerState(ctx context.Context, name, id string) (exists, owned bool, err error) {
	runCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if _, err := s.exec(runCtx, "container", "exists", name); err != nil {
		if exitCode(err) == 1 {
			return false, false, nil
		}
		return false, false, fmt.Errorf("podman inspect failed: %w", err)
	}
	output, err := s.exec(runCtx, "inspect", "--format", `{{index .Config.Labels "nit.drop.id"}}`, name)
	if err != nil {
		return false, false, fmt.Errorf("podman inspect failed: %w", err)
	}
	return true, strings.TrimSpace(string(output)) == id, nil
}

func (s *Services) containerRunning(ctx context.Context, name string) (bool, error) {
	runCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	output, err := s.exec(runCtx, "inspect", "--format", "{{.State.Running}}", name)
	if err != nil {
		return false, fmt.Errorf("podman inspect failed: %w", err)
	}
	return strings.TrimSpace(string(output)) == "true", nil
}

func (s *Services) publishedPort(ctx context.Context, name string, containerPort int) (int, error) {
	runCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	output, err := s.exec(runCtx, "port", name, strconv.Itoa(containerPort)+"/tcp")
	if err != nil {
		return 0, fmt.Errorf("podman port failed: %w", err)
	}
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "127.0.0.1:") {
			continue
		}
		value := strings.TrimPrefix(line, "127.0.0.1:")
		port, err := strconv.Atoi(value)
		if err == nil && port > 0 {
			return port, nil
		}
	}
	return 0, fmt.Errorf("container %s publishes no loopback port for %d", name, containerPort)
}

func (s *Services) waitHealthy(ctx context.Context, port int, health string) error {
	if health == "" {
		health = "/"
	}
	target := fmt.Sprintf("http://127.0.0.1:%d%s", port, health)
	deadline := time.Now().Add(serviceHealthTimeout)
	var lastErr error
	for time.Now().Before(deadline) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			return err
		}
		resp, err := s.client.Do(req)
		if err == nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
			resp.Body.Close()
			if resp.StatusCode < 500 {
				return nil
			}
			lastErr = fmt.Errorf("health returned %s", resp.Status)
		} else {
			lastErr = err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(300 * time.Millisecond):
		}
	}
	return fmt.Errorf("service did not become healthy at %s: %w", target, lastErr)
}

func (s *Services) podmanExec(ctx context.Context, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, s.podman, args...)
	var output tailBuffer
	output.limit = serviceTailLimit
	cmd.Stdout = &output
	cmd.Stderr = &output
	err := cmd.Run()
	if err != nil && errors.Is(err, exec.ErrNotFound) {
		return output.Bytes(), fmt.Errorf("podman is not installed")
	}
	return output.Bytes(), err
}

func commandTail(output []byte) string {
	text := strings.TrimSpace(string(output))
	if text == "" {
		return ""
	}
	if len(text) > 2000 {
		text = text[len(text)-2000:]
	}
	return ": " + text
}

type tailBuffer struct {
	data  []byte
	limit int
}

func (b *tailBuffer) Write(p []byte) (int, error) {
	b.data = append(b.data, p...)
	if b.limit > 0 && len(b.data) > b.limit {
		b.data = b.data[len(b.data)-b.limit:]
	}
	return len(p), nil
}

func (b *tailBuffer) Bytes() []byte {
	return b.data
}

func freePort() (int, error) {
	for attempt := 0; attempt < 5; attempt++ {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			continue
		}
		port := listener.Addr().(*net.TCPAddr).Port
		listener.Close()
		return port, nil
	}
	return 0, errors.New("could not allocate a local port")
}

func exitCode(err error) int {
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
}
