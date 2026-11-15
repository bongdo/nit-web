package gate

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var ErrNoDevice = errors.New("gate: unknown device")

const (
	unknownDevice = "неизвестно"
	touchInterval = time.Minute
)

type Device struct {
	ID      string `json:"id"`
	User    string `json:"user"`
	Name    string `json:"name"`
	IP      string `json:"ip"`
	Created int64  `json:"created"`
	Seen    int64  `json:"seen"`
}

type Devices struct {
	mu    sync.Mutex
	path  string
	now   func() time.Time
	items map[string]Device
}

type devicesFile struct {
	Devices []Device `json:"devices"`
}

func DefaultDevicesPath() string {
	if path := strings.TrimSpace(os.Getenv("NIT_GATE_DEVICES")); path != "" {
		return path
	}
	config, err := os.UserConfigDir()
	if err != nil {
		return "devices.json"
	}
	return filepath.Join(config, "nit-gui", "devices.json")
}

func OpenDevices(path string) (*Devices, error) {
	devices := &Devices{path: path, now: time.Now, items: map[string]Device{}}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return devices, nil
		}
		return nil, err
	}
	var file devicesFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("gate: parse %s: %w", path, err)
	}
	for _, device := range file.Devices {
		if device.ID != "" {
			devices.items[device.ID] = device
		}
	}
	return devices, nil
}

func (d *Devices) Add(user, name, ip string) (Device, error) {
	id, err := newDeviceID()
	if err != nil {
		return Device{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = unknownDevice
	}
	now := d.now().Unix()
	device := Device{ID: id, User: normalizeName(user), Name: name, IP: ip, Created: now, Seen: now}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.items[id] = device
	return device, d.save()
}

func (d *Devices) Touch(id, ip string) {
	now := d.now()
	d.mu.Lock()
	defer d.mu.Unlock()
	device, ok := d.items[id]
	if !ok {
		return
	}
	if now.Unix()-device.Seen < int64(touchInterval.Seconds()) {
		return
	}
	device.Seen = now.Unix()
	device.IP = ip
	d.items[id] = device
	_ = d.save()
}

func (d *Devices) List() []Device {
	d.mu.Lock()
	defer d.mu.Unlock()
	list := make([]Device, 0, len(d.items))
	for _, device := range d.items {
		list = append(list, device)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].User != list[j].User {
			return list[i].User < list[j].User
		}
		if list[i].Seen != list[j].Seen {
			return list[i].Seen > list[j].Seen
		}
		return list[i].ID < list[j].ID
	})
	return list
}

func (d *Devices) ListFor(user string) []Device {
	user = normalizeName(user)
	list := []Device{}
	for _, device := range d.List() {
		if device.User == user {
			list = append(list, device)
		}
	}
	return list
}

func (d *Devices) Remove(id string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.items[id]; !ok {
		return ErrNoDevice
	}
	delete(d.items, id)
	return d.save()
}

func (d *Devices) Has(user, id string) bool {
	if id == "" {
		return false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	device, ok := d.items[id]
	return ok && device.User == normalizeName(user)
}

func (d *Devices) save() error {
	if d.path == "" {
		return nil
	}
	file := devicesFile{Devices: make([]Device, 0, len(d.items))}
	for _, device := range d.items {
		file.Devices = append(file.Devices, device)
	}
	sort.Slice(file.Devices, func(i, j int) bool { return file.Devices[i].ID < file.Devices[j].ID })
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(d.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".devices-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), d.path)
}

func newDeviceID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

var browserLabels = []struct{ token, label string }{
	{"EdgiOS/", "Edge"},
	{"EdgA/", "Edge"},
	{"Edg/", "Edge"},
	{"OPiOS/", "Opera"},
	{"OPR/", "Opera"},
	{"YaBrowser/", "Yandex"},
	{"SamsungBrowser/", "Samsung"},
	{"CriOS/", "Chrome"},
	{"FxiOS/", "Firefox"},
	{"HeadlessChrome/", "Headless Chrome"},
	{"Firefox/", "Firefox"},
	{"Chrome/", "Chrome"},
	{"Safari/", "Safari"},
}

var systemLabels = []struct{ token, label string }{
	{"Android", "Android"},
	{"iPhone", "iOS"},
	{"iPad", "iOS"},
	{"CrOS", "ChromeOS"},
	{"Windows", "Windows"},
	{"Macintosh", "macOS"},
	{"Linux", "Linux"},
}

var clientLabels = []struct{ token, label string }{
	{"curl/", "curl"},
	{"Wget/", "wget"},
	{"Go-http-client", "Go-клиент"},
	{"python-requests", "python"},
	{"okhttp", "Android-приложение"},
	{"PostmanRuntime", "Postman"},
}

func deviceName(agent string) string {
	if strings.TrimSpace(agent) == "" {
		return unknownDevice
	}
	if client := labelFor(agent, clientLabels); client != "" {
		return client
	}
	browser := labelFor(agent, browserLabels)
	system := labelFor(agent, systemLabels)
	switch {
	case browser == "" && system == "":
		return productName(agent)
	case browser == "":
		return system
	case system == "":
		return browser
	}
	return browser + " · " + system
}

func productName(agent string) string {
	product := strings.Fields(agent)[0]
	if cut := strings.IndexByte(product, '/'); cut > 0 {
		product = product[:cut]
	}
	if len(product) > 24 {
		product = product[:24]
	}
	if product == "" {
		return unknownDevice
	}
	return product
}

func labelFor(agent string, table []struct{ token, label string }) string {
	for _, entry := range table {
		if strings.Contains(agent, entry.token) {
			return entry.label
		}
	}
	return ""
}
