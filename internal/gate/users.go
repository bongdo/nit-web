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

	"nitgui/internal/auth"
)

const (
	StatusPending = "pending"
	StatusInvited = "invited"
	StatusActive  = "active"
)

var (
	ErrUserExists    = errors.New("gate: user exists")
	ErrUnknownUser   = errors.New("gate: unknown user")
	ErrBadName       = errors.New("gate: invalid name")
	ErrBadPassword   = errors.New("gate: password must be at least 8 characters")
	ErrNotInvited    = errors.New("gate: no open invitation")
	ErrLastAdmin     = errors.New("gate: the last admin cannot be removed")
	ErrActiveAccount = errors.New("нельзя удалить активный аккаунт")
	minPasswordSize  = 8
)

type User struct {
	Name    string `json:"name"`
	Role    string `json:"role"`
	Status  string `json:"status"`
	Hash    string `json:"hash,omitempty"`
	Token   string `json:"token,omitempty"`
	Created int64  `json:"created"`
}

type Store struct {
	mu    sync.Mutex
	path  string
	users map[string]User
}

type storeFile struct {
	Users []User `json:"users"`
}

func DefaultUsersPath() string {
	if path := strings.TrimSpace(os.Getenv("NIT_GATE_USERS")); path != "" {
		return path
	}
	state := os.Getenv("XDG_STATE_HOME")
	if state == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "users.json"
		}
		state = filepath.Join(home, ".local", "state")
	}
	return filepath.Join(state, "nit-gui", "gate", "users.json")
}

func OpenStore(path string) (*Store, error) {
	store := &Store{path: path, users: map[string]User{}}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return store, nil
		}
		return nil, err
	}
	var file storeFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("gate: parse %s: %w", path, err)
	}
	for _, user := range file.Users {
		store.users[user.Name] = user
	}
	return store, nil
}

func (s *Store) List() []User {
	s.mu.Lock()
	defer s.mu.Unlock()
	users := make([]User, 0, len(s.users))
	for _, user := range s.users {
		users = append(users, user)
	}
	sort.Slice(users, func(i, j int) bool {
		if users[i].Status != users[j].Status {
			return users[i].Status < users[j].Status
		}
		return users[i].Name < users[j].Name
	})
	return users
}

func (s *Store) Get(name string) (User, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	user, ok := s.users[normalizeName(name)]
	return user, ok
}

func (s *Store) ByToken(token string) (User, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, user := range s.users {
		if token != "" && user.Token == token {
			return user, true
		}
	}
	return User{}, false
}

func (s *Store) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.users)
}

func (s *Store) Seed(name string, role string, hash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.users) > 0 {
		return nil
	}
	name = normalizeName(name)
	if !validName(name) || hash == "" {
		return ErrBadName
	}
	if role != "admin" && role != "member" {
		role = "admin"
	}
	s.users[name] = User{Name: name, Role: role, Status: StatusActive, Hash: hash, Created: time.Now().Unix()}
	return s.save()
}

func (s *Store) Request(name string) (User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	name = normalizeName(name)
	if !validName(name) {
		return User{}, ErrBadName
	}
	if _, ok := s.users[name]; ok {
		return User{}, ErrUserExists
	}
	user := User{Name: name, Role: "member", Status: StatusPending, Created: time.Now().Unix()}
	s.users[name] = user
	return user, s.save()
}

func (s *Store) Approve(name string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	name = normalizeName(name)
	user, ok := s.users[name]
	if !ok {
		return "", ErrUnknownUser
	}
	token, err := newToken()
	if err != nil {
		return "", err
	}
	user.Status = StatusInvited
	user.Token = token
	s.users[name] = user
	return token, s.save()
}

func (s *Store) Reject(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	name = normalizeName(name)
	user, ok := s.users[name]
	if !ok {
		return ErrUnknownUser
	}
	if user.Status == StatusActive && user.Role == "admin" && s.adminCountLocked() <= 1 {
		return ErrLastAdmin
	}
	if user.Status == StatusActive {
		return ErrActiveAccount
	}
	delete(s.users, name)
	return s.save()
}

func (s *Store) SetPassword(token string, password string) (User, error) {
	if len(password) < minPasswordSize {
		return User{}, ErrBadPassword
	}
	hash, err := auth.Hash(password)
	if err != nil {
		return User{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for name, user := range s.users {
		if token == "" || user.Token != token {
			continue
		}
		user.Hash = hash
		user.Token = ""
		user.Status = StatusActive
		s.users[name] = user
		return user, s.save()
	}
	return User{}, ErrNotInvited
}

func (s *Store) SetPasswordHash(name string, password string) error {
	if len(password) < minPasswordSize {
		return ErrBadPassword
	}
	hash, err := auth.Hash(password)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	user, ok := s.users[normalizeName(name)]
	if !ok {
		return ErrUnknownUser
	}
	user.Hash = hash
	s.users[user.Name] = user
	return s.save()
}

func (s *Store) Authenticate(name string, password string) (User, bool) {
	user, ok := s.Get(name)
	if !ok || user.Status != StatusActive || user.Hash == "" {
		return User{}, false
	}
	if !auth.Verify(user.Hash, password) {
		return User{}, false
	}
	return user, true
}

func (s *Store) adminCountLocked() int {
	count := 0
	for _, user := range s.users {
		if user.Role == "admin" && user.Status == StatusActive {
			count++
		}
	}
	return count
}

func (s *Store) save() error {
	file := storeFile{Users: make([]User, 0, len(s.users))}
	for _, user := range s.users {
		file.Users = append(file.Users, user)
	}
	sort.Slice(file.Users, func(i, j int) bool { return file.Users[i].Name < file.Users[j].Name })
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".users-*")
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
	return os.Rename(tmp.Name(), s.path)
}

func normalizeName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
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

func newToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
