package gate

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"nitgui/internal/gateid"
)

type Route struct {
	Prefix   string `json:"prefix"`
	Cap      string `json:"cap,omitempty"`
	Optional bool   `json:"optional,omitempty"`
	Upstream string `json:"upstream"`
	Note     string `json:"note,omitempty"`
}

type Routes struct {
	mu   sync.RWMutex
	path string
	list []Route
}

type routesFile struct {
	Routes []Route `json:"routes"`
}

func DefaultRoutesPath() string {
	if path := strings.TrimSpace(os.Getenv("NIT_GATE_ROUTES")); path != "" {
		return path
	}
	config, err := os.UserConfigDir()
	if err != nil {
		return "routes.json"
	}
	return filepath.Join(config, "nit-gui", "routes.json")
}

func defaultRoutes() []Route {
	return []Route{
		{Prefix: "/nit", Cap: gateid.AdminHost, Upstream: "http://127.0.0.1:7791", Note: "редактор, терминал"},
		{Prefix: "/pero", Cap: gateid.AdminHost, Upstream: "http://127.0.0.1:7789", Note: "редактор файлов"},
		{Prefix: "/term", Cap: gateid.AdminHost, Upstream: "http://127.0.0.1:7795", Note: "shell"},
		{Prefix: "/share", Optional: true, Upstream: "http://127.0.0.1:7791", Note: "drop: ссылки и менеджер"},
	}
}

func OpenRoutes(path string) (*Routes, error) {
	routes := &Routes{path: path}
	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, err
		}
		routes.list = defaultRoutes()
		if err := routes.write(); err != nil {
			return nil, err
		}
		return routes, nil
	}
	if err := routes.parse(data); err != nil {
		return nil, err
	}
	return routes, nil
}

func (r *Routes) Reload() error {
	data, err := os.ReadFile(r.path)
	if err != nil {
		return err
	}
	return r.parse(data)
}

func (r *Routes) parse(data []byte) error {
	var file routesFile
	if err := json.Unmarshal(data, &file); err != nil {
		return err
	}
	if err := validate(file.Routes); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.list = file.Routes
	return nil
}

func validate(list []Route) error {
	for _, route := range list {
		if !strings.HasPrefix(route.Prefix, "/") || route.Prefix == "/" {
			return errors.New("gate: route prefix must start with / and not be /: " + route.Prefix)
		}
		if route.Upstream == "" {
			return errors.New("gate: route has no upstream: " + route.Prefix)
		}
		if route.Optional && route.Cap != "" {
			return errors.New("gate: route is both optional and gated: " + route.Prefix)
		}
		if !route.Optional && !knownCap(route.Cap) {
			return errors.New("gate: unknown capability: " + route.Cap)
		}
	}
	return nil
}

func knownCap(capability string) bool {
	for _, c := range gateid.Caps(gateid.RoleAdmin) {
		if c == capability {
			return true
		}
	}
	return false
}

func (r *Routes) write() error {
	file := routesFile{Routes: r.list}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(r.path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(r.path, append(data, '\n'), 0o600)
}

func (r *Routes) List() []Route {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return append([]Route(nil), r.list...)
}

func (r *Routes) Match(path string) (Route, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	best := Route{}
	found := false
	for _, route := range r.list {
		if path == route.Prefix || strings.HasPrefix(path, route.Prefix+"/") {
			if !found || len(route.Prefix) > len(best.Prefix) {
				best, found = route, true
			}
		}
	}
	return best, found
}

func (r *Routes) sorted() []Route {
	list := r.List()
	sort.Slice(list, func(i, j int) bool { return list[i].Prefix < list[j].Prefix })
	return list
}
