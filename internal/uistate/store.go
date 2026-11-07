package uistate

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type ModelRef struct {
	ID         string `json:"id"`
	ProviderID string `json:"providerID"`
	Variant    string `json:"variant,omitempty"`
}

type Draft struct {
	Text      string `json:"text"`
	UpdatedAt int64  `json:"updatedAt"`
}

type InstanceState struct {
	Hidden []string          `json:"hidden"`
	Status map[string]string `json:"status"`
	Drafts map[string]Draft  `json:"drafts,omitempty"`
	Model  *ModelRef         `json:"model,omitempty"`
	Agent  string            `json:"agent,omitempty"`
}

type State struct {
	Instances map[string]InstanceState `json:"instances,omitempty"`
	Hidden    []string                 `json:"hidden,omitempty"`
	Status    map[string]string        `json:"status,omitempty"`
	Drafts    map[string]Draft         `json:"drafts,omitempty"`
	Model     *ModelRef                `json:"model,omitempty"`
	Agent     string                   `json:"agent,omitempty"`
}

type Store struct {
	mu    sync.Mutex
	path  string
	state State
}

func DefaultPath() string {
	if path := os.Getenv("NIT_GUI_STATE"); path != "" {
		return path
	}
	if dir := os.Getenv("XDG_STATE_HOME"); dir != "" {
		return filepath.Join(dir, "nit-gui", "ui-state.json")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".local", "state", "nit-gui", "ui-state.json")
}

func Open(path, defaultInstance string) (*Store, error) {
	if defaultInstance == "" {
		defaultInstance = "local"
	}
	store := &Store{path: path, state: newState()}
	if path == "" {
		return store, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return store, nil
		}
		return store, err
	}
	if err := json.Unmarshal(raw, &store.state); err != nil {
		store.state = newState()
		return store, err
	}
	if store.state.Instances == nil {
		store.state.Instances = map[string]InstanceState{}
	}
	migrated := false
	if len(store.state.Instances) == 0 && hasLegacy(store.state) {
		store.state.Instances[defaultInstance] = normalizeInstance(InstanceState{
			Hidden: store.state.Hidden,
			Status: store.state.Status,
			Drafts: store.state.Drafts,
			Model:  store.state.Model,
			Agent:  store.state.Agent,
		})
		migrated = true
	}
	store.state.Hidden = nil
	store.state.Status = nil
	store.state.Drafts = nil
	store.state.Model = nil
	store.state.Agent = ""
	if migrated {
		if err := store.saveLocked(); err != nil {
			return store, err
		}
	}
	return store, nil
}

func newState() State {
	return State{Instances: map[string]InstanceState{}}
}

func hasLegacy(state State) bool {
	return len(state.Hidden) > 0 || len(state.Status) > 0 || len(state.Drafts) > 0 || state.Model != nil || state.Agent != ""
}

func normalizeInstance(state InstanceState) InstanceState {
	if state.Hidden == nil {
		state.Hidden = []string{}
	}
	if state.Status == nil {
		state.Status = map[string]string{}
	}
	if state.Drafts == nil {
		state.Drafts = map[string]Draft{}
	}
	return state
}

func (s *Store) Snapshot(instance string) InstanceState {
	s.mu.Lock()
	defer s.mu.Unlock()
	current := s.state.Instances[instance]
	hidden := make([]string, len(current.Hidden))
	copy(hidden, current.Hidden)
	sort.Strings(hidden)
	status := make(map[string]string, len(current.Status))
	for id, value := range current.Status {
		status[id] = value
	}
	drafts := make(map[string]Draft, len(current.Drafts))
	for key, draft := range current.Drafts {
		drafts[key] = draft
	}
	var model *ModelRef
	if current.Model != nil {
		clone := *current.Model
		model = &clone
	}
	return InstanceState{Hidden: hidden, Status: status, Drafts: drafts, Model: model, Agent: current.Agent}
}

func (s *Store) instanceLocked(instance string) InstanceState {
	if s.state.Instances == nil {
		s.state.Instances = map[string]InstanceState{}
	}
	state, ok := s.state.Instances[instance]
	if !ok {
		state = InstanceState{Status: map[string]string{}, Drafts: map[string]Draft{}}
	}
	return normalizeInstance(state)
}

func (s *Store) SetHidden(instance string, ids []string, hidden bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.instanceLocked(instance)
	current := make(map[string]struct{}, len(state.Hidden))
	for _, id := range state.Hidden {
		current[id] = struct{}{}
	}
	for _, id := range ids {
		if hidden {
			current[id] = struct{}{}
		} else {
			delete(current, id)
		}
	}
	next := make([]string, 0, len(current))
	for id := range current {
		next = append(next, id)
	}
	sort.Strings(next)
	state.Hidden = next
	s.state.Instances[instance] = state
	return s.saveLocked()
}

func (s *Store) SetStatus(instance, id, status string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.instanceLocked(instance)
	if status == "" {
		delete(state.Status, id)
	} else {
		state.Status[id] = status
	}
	s.state.Instances[instance] = state
	return s.saveLocked()
}

func (s *Store) SetDraft(instance, key, text string) (Draft, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.instanceLocked(instance)
	if text == "" {
		delete(state.Drafts, key)
		s.state.Instances[instance] = state
		return Draft{}, s.saveLocked()
	}
	draft := Draft{Text: text, UpdatedAt: time.Now().UnixMilli()}
	state.Drafts[key] = draft
	s.state.Instances[instance] = state
	return draft, s.saveLocked()
}

func (s *Store) Draft(instance, key string) Draft {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state.Instances[instance].Drafts[key]
}

func (s *Store) SetModel(instance string, model *ModelRef) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.instanceLocked(instance)
	if model == nil {
		state.Model = nil
	} else {
		clone := *model
		state.Model = &clone
	}
	s.state.Instances[instance] = state
	return s.saveLocked()
}

func (s *Store) SetAgent(instance, agent string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.instanceLocked(instance)
	state.Agent = agent
	s.state.Instances[instance] = state
	return s.saveLocked()
}

func (s *Store) Has(instance string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.state.Instances[instance]
	return ok
}

func (s *Store) Rename(old, next string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if old == next {
		return nil
	}
	state, ok := s.state.Instances[old]
	if !ok {
		return nil
	}
	if _, exists := s.state.Instances[next]; exists {
		return errors.New("ui state already exists for the new instance name")
	}
	delete(s.state.Instances, old)
	s.state.Instances[next] = state
	return s.saveLocked()
}

func (s *Store) Remove(instance, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.instanceLocked(instance)
	next := state.Hidden[:0]
	for _, hidden := range state.Hidden {
		if hidden != id {
			next = append(next, hidden)
		}
	}
	state.Hidden = next
	delete(state.Status, id)
	delete(state.Drafts, id)
	s.state.Instances[instance] = state
	return s.saveLocked()
}

func (s *Store) saveLocked() error {
	if s.path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".ui-state-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(append(raw, '\n')); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, s.path)
}
