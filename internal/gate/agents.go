package gate

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
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

var (
	ErrMachineExists = errors.New("gate: machine already has a token")
	ErrNoMachine     = errors.New("gate: unknown machine")
)

type Machine struct {
	Name      string `json:"name"`
	TokenHash string `json:"tokenHash"`
	Added     int64  `json:"added"`
}

type Agents struct {
	mu       sync.Mutex
	path     string
	machines map[string]Machine
}

type agentsFile struct {
	Machines []Machine `json:"machines"`
}

func DefaultAgentsPath() string {
	if path := strings.TrimSpace(os.Getenv("NIT_GATE_AGENTS")); path != "" {
		return path
	}
	config, err := os.UserConfigDir()
	if err != nil {
		return "agents.json"
	}
	return filepath.Join(config, "nit-gui", "agents.json")
}

func OpenAgents(path string) (*Agents, error) {
	agents := &Agents{path: path, machines: map[string]Machine{}}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return agents, nil
		}
		return nil, err
	}
	var file agentsFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("gate: parse %s: %w", path, err)
	}
	for _, machine := range file.Machines {
		agents.machines[machine.Name] = machine
	}
	return agents, nil
}

func (a *Agents) Add(name string) (string, error) {
	name = normalizeName(name)
	if !validName(name) {
		return "", ErrBadName
	}
	token, err := machineToken()
	if err != nil {
		return "", err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.machines[name]; ok {
		return "", ErrMachineExists
	}
	a.machines[name] = Machine{Name: name, TokenHash: hashToken(token), Added: time.Now().Unix()}
	return token, a.save()
}

func (a *Agents) Remove(name string) error {
	name = normalizeName(name)
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.machines[name]; !ok {
		return ErrNoMachine
	}
	delete(a.machines, name)
	return a.save()
}

func (a *Agents) List() []Machine {
	a.mu.Lock()
	defer a.mu.Unlock()
	list := make([]Machine, 0, len(a.machines))
	for _, machine := range a.machines {
		list = append(list, machine)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Name < list[j].Name })
	return list
}

func (a *Agents) Exists(name string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	_, ok := a.machines[name]
	return ok
}

func (a *Agents) Active(name string, hash string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	machine, ok := a.machines[name]
	return ok && subtle.ConstantTimeCompare([]byte(machine.TokenHash), []byte(hash)) == 1
}

func (a *Agents) Authorize(token string) (Machine, bool) {
	if token == "" {
		return Machine{}, false
	}
	hash := hashToken(token)
	a.mu.Lock()
	defer a.mu.Unlock()
	var found Machine
	ok := false
	for _, machine := range a.machines {
		if subtle.ConstantTimeCompare([]byte(machine.TokenHash), []byte(hash)) == 1 {
			found, ok = machine, true
		}
	}
	return found, ok
}

func (a *Agents) save() error {
	file := agentsFile{Machines: make([]Machine, 0, len(a.machines))}
	for _, machine := range a.machines {
		file.Machines = append(file.Machines, machine)
	}
	sort.Slice(file.Machines, func(i, j int) bool { return file.Machines[i].Name < file.Machines[j].Name })
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(a.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".agents-*")
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
	return os.Rename(tmp.Name(), a.path)
}

func machineToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
