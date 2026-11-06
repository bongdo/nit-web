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

type State struct {
	Hidden []string          `json:"hidden"`
	Status map[string]string `json:"status"`
	Drafts map[string]Draft  `json:"drafts,omitempty"`
	Model  *ModelRef         `json:"model,omitempty"`
	Agent  string            `json:"agent,omitempty"`
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

func Open(path string) (*Store, error) {
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
	if store.state.Status == nil {
		store.state.Status = map[string]string{}
	}
	if store.state.Drafts == nil {
		store.state.Drafts = map[string]Draft{}
	}
	return store, nil
}

func newState() State {
	return State{Status: map[string]string{}, Drafts: map[string]Draft{}}
}

func (s *Store) Snapshot() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	hidden := make([]string, len(s.state.Hidden))
	copy(hidden, s.state.Hidden)
	sort.Strings(hidden)
	status := make(map[string]string, len(s.state.Status))
	for id, value := range s.state.Status {
		status[id] = value
	}
	drafts := make(map[string]Draft, len(s.state.Drafts))
	for key, draft := range s.state.Drafts {
		drafts[key] = draft
	}
	var model *ModelRef
	if s.state.Model != nil {
		copy := *s.state.Model
		model = &copy
	}
	return State{Hidden: hidden, Status: status, Drafts: drafts, Model: model, Agent: s.state.Agent}
}

func (s *Store) SetHidden(ids []string, hidden bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	current := make(map[string]struct{}, len(s.state.Hidden))
	for _, id := range s.state.Hidden {
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
	s.state.Hidden = next
	return s.saveLocked()
}

func (s *Store) SetStatus(id, status string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if status == "" {
		delete(s.state.Status, id)
	} else {
		s.state.Status[id] = status
	}
	return s.saveLocked()
}

func (s *Store) SetDraft(key, text string) (Draft, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if text == "" {
		delete(s.state.Drafts, key)
		return Draft{}, s.saveLocked()
	}
	draft := Draft{Text: text, UpdatedAt: time.Now().UnixMilli()}
	s.state.Drafts[key] = draft
	return draft, s.saveLocked()
}

func (s *Store) Draft(key string) Draft {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state.Drafts[key]
}

func (s *Store) SetModel(model *ModelRef) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if model == nil {
		s.state.Model = nil
	} else {
		copy := *model
		s.state.Model = &copy
	}
	return s.saveLocked()
}

func (s *Store) SetAgent(agent string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Agent = agent
	return s.saveLocked()
}

func (s *Store) Remove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.state.Hidden[:0]
	for _, hidden := range s.state.Hidden {
		if hidden != id {
			next = append(next, hidden)
		}
	}
	s.state.Hidden = next
	delete(s.state.Status, id)
	delete(s.state.Drafts, id)
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
