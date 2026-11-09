package drop

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	DefaultTTL = 7 * 24 * time.Hour
	MetaName   = "entry.json"
)

var ErrNotFound = errors.New("drop entry not found")

type File struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

type Entry struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	Kind    string    `json:"kind"`
	Created time.Time `json:"created"`
	Expires time.Time `json:"expires,omitempty"`
	Files   []File    `json:"files"`
	Size    int64     `json:"size"`
}

func (e Entry) Expired(now time.Time) bool {
	return !e.Expires.IsZero() && !now.Before(e.Expires)
}

func (e Entry) Doc() string {
	for _, name := range []string{"index.md", "README.md", "readme.md"} {
		if e.Has(name) {
			return name
		}
	}
	for _, file := range e.Files {
		if isDocPath(file.Path) {
			return file.Path
		}
	}
	return ""
}

func (e Entry) Has(name string) bool {
	for _, file := range e.Files {
		if file.Path == name {
			return true
		}
	}
	return false
}

func (e Entry) App() string {
	for _, name := range []string{"index.html", "index.htm"} {
		if e.Has(name) {
			return name
		}
	}
	if len(e.Files) == 1 && isHTMLPath(e.Files[0].Path) {
		return e.Files[0].Path
	}
	return ""
}

type Store struct {
	root string
	mu   sync.Mutex
	now  func() time.Time
}

func DefaultRoot() string {
	if root := strings.TrimSpace(os.Getenv("NIT_DROP_ROOT")); root != "" {
		return root
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "nit-gui-drop")
	}
	return filepath.Join(home, ".local", "share", "nit-gui", "drop")
}

func Open(root string) (*Store, error) {
	if strings.TrimSpace(root) == "" {
		root = DefaultRoot()
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create drop root: %w", err)
	}
	return &Store{root: root, now: time.Now}, nil
}

func (s *Store) Root() string {
	return s.root
}

func (s *Store) List() ([]Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items, err := os.ReadDir(s.root)
	if err != nil {
		return nil, err
	}
	now := s.now()
	entries := make([]Entry, 0, len(items))
	for _, item := range items {
		if !item.IsDir() {
			continue
		}
		entry, err := s.read(item.Name())
		if err != nil {
			s.cleanOrphan(item.Name(), now)
			continue
		}
		if entry.Expired(now) {
			_ = os.RemoveAll(filepath.Join(s.root, entry.ID))
			continue
		}
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Created.After(entries[j].Created)
	})
	return entries, nil
}

func (s *Store) Get(id string) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, err := s.read(id)
	if err != nil {
		return Entry{}, err
	}
	if entry.Expired(s.now()) {
		_ = os.RemoveAll(filepath.Join(s.root, entry.ID))
		return Entry{}, ErrNotFound
	}
	return entry, nil
}

func (s *Store) Delete(id string) error {
	if !validID(id) {
		return ErrNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.read(id); err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(s.root, id))
}

func (s *Store) FilePath(id, rel string) (string, error) {
	if !validID(id) {
		return "", ErrNotFound
	}
	rel, err := safeRel(rel)
	if err != nil {
		return "", err
	}
	return filepath.Join(s.root, id, filepath.FromSlash(rel)), nil
}

func (s *Store) NewEntry(name string) (*Builder, error) {
	id, dir, err := s.mkdir()
	if err != nil {
		return nil, err
	}
	return &Builder{
		store: s,
		dir:   dir,
		seen:  map[string]struct{}{},
		ttl:   DefaultTTL,
		entry: Entry{
			ID:      id,
			Name:    cleanName(name),
			Created: s.now(),
		},
	}, nil
}

func (s *Store) PublishPath(src, name string, ttl time.Duration) (Entry, error) {
	info, err := os.Stat(src)
	if err != nil {
		return Entry{}, err
	}
	if name == "" {
		name = filepath.Base(filepath.Clean(src))
	}
	builder, err := s.NewEntry(name)
	if err != nil {
		return Entry{}, err
	}
	builder.SetTTL(ttl)
	fail := func(err error) (Entry, error) {
		builder.Abort()
		return Entry{}, err
	}
	if !info.IsDir() {
		file, err := os.Open(src)
		if err != nil {
			return fail(err)
		}
		defer file.Close()
		if err := builder.AddFile(filepath.Base(src), file); err != nil {
			return fail(err)
		}
		return builder.Commit()
	}
	err = filepath.WalkDir(src, func(current string, item fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if current == src {
			return nil
		}
		if item.Type()&fs.ModeSymlink != 0 {
			if item.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !item.Type().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(src, current)
		if err != nil {
			return err
		}
		file, err := os.Open(current)
		if err != nil {
			return err
		}
		defer file.Close()
		if err := builder.AddFile(filepath.ToSlash(rel), file); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return fail(err)
	}
	return builder.Commit()
}

func (s *Store) mkdir() (string, string, error) {
	for range 20 {
		var raw [8]byte
		if _, err := rand.Read(raw[:]); err != nil {
			return "", "", err
		}
		id := "d-" + hex.EncodeToString(raw[:])
		dir := filepath.Join(s.root, id)
		err := os.Mkdir(dir, 0o700)
		if err == nil {
			return id, dir, nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return "", "", err
		}
	}
	return "", "", errors.New("could not allocate drop id")
}

func (s *Store) read(id string) (Entry, error) {
	if !validID(id) {
		return Entry{}, ErrNotFound
	}
	data, err := os.ReadFile(filepath.Join(s.root, id, MetaName))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return Entry{}, ErrNotFound
		}
		return Entry{}, err
	}
	var entry Entry
	if err := json.Unmarshal(data, &entry); err != nil {
		return Entry{}, err
	}
	if entry.ID != id {
		return Entry{}, ErrNotFound
	}
	return entry, nil
}

func (s *Store) cleanOrphan(id string, now time.Time) {
	dir := filepath.Join(s.root, id)
	info, err := os.Stat(dir)
	if err != nil || now.Sub(info.ModTime()) < time.Hour {
		return
	}
	_ = os.RemoveAll(dir)
}

type Builder struct {
	store  *Store
	entry  Entry
	dir    string
	seen   map[string]struct{}
	ttl    time.Duration
	closed bool
}

func (b *Builder) SetName(name string) {
	b.entry.Name = cleanName(name)
}

func (b *Builder) SetTTL(ttl time.Duration) {
	if ttl < 0 {
		ttl = 0
	}
	b.ttl = ttl
}

func (b *Builder) AddFile(rel string, src io.Reader) error {
	if b.closed {
		return errors.New("drop entry is closed")
	}
	rel, err := safeRel(rel)
	if err != nil {
		return err
	}
	rel = b.unique(rel)
	dest := filepath.Join(b.dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
		return err
	}
	file, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	size, copyErr := io.Copy(file, src)
	closeErr := file.Close()
	if copyErr != nil {
		_ = os.Remove(dest)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(dest)
		return closeErr
	}
	b.seen[rel] = struct{}{}
	b.entry.Files = append(b.entry.Files, File{Path: rel, Size: size})
	return nil
}

func (b *Builder) Commit() (Entry, error) {
	if b.closed {
		return Entry{}, errors.New("drop entry is closed")
	}
	if len(b.entry.Files) == 0 {
		b.Abort()
		return Entry{}, errors.New("drop entry has no files")
	}
	b.closed = true
	sort.Slice(b.entry.Files, func(i, j int) bool {
		return b.entry.Files[i].Path < b.entry.Files[j].Path
	})
	b.entry.Size = 0
	for _, file := range b.entry.Files {
		b.entry.Size += file.Size
	}
	b.entry.Kind = detectKind(b.entry)
	if b.ttl > 0 {
		b.entry.Expires = b.entry.Created.Add(b.ttl)
	}
	data, err := json.MarshalIndent(b.entry, "", "  ")
	if err != nil {
		b.Abort()
		return Entry{}, err
	}
	tmp := filepath.Join(b.dir, ".entry.tmp")
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		b.Abort()
		return Entry{}, err
	}
	if err := os.Rename(tmp, filepath.Join(b.dir, MetaName)); err != nil {
		b.Abort()
		return Entry{}, err
	}
	return b.entry, nil
}

func (b *Builder) Abort() {
	b.closed = true
	_ = os.RemoveAll(b.dir)
}

func (b *Builder) unique(rel string) string {
	if _, ok := b.seen[rel]; !ok {
		return rel
	}
	ext := path.Ext(rel)
	base := strings.TrimSuffix(rel, ext)
	for i := 2; ; i++ {
		candidate := fmt.Sprintf("%s-%d%s", base, i, ext)
		if _, ok := b.seen[candidate]; !ok {
			return candidate
		}
	}
}

func safeRel(rel string) (string, error) {
	rel = strings.TrimSpace(strings.ReplaceAll(rel, "\\", "/"))
	rel = strings.TrimPrefix(rel, "/")
	rel = path.Clean(rel)
	if rel == "." || rel == "" || rel == ".." || strings.HasPrefix(rel, "../") || path.IsAbs(rel) {
		return "", errors.New("invalid drop path")
	}
	if strings.ContainsRune(rel, 0) || strings.Contains(rel, ":") {
		return "", errors.New("invalid drop path")
	}
	if rel == MetaName || strings.HasPrefix(rel, ".entry") {
		return "", errors.New("reserved drop path")
	}
	return rel, nil
}

func cleanName(name string) string {
	name = strings.TrimSpace(name)
	name = strings.Trim(name, "/\\")
	if name == "" || name == "." {
		name = "upload"
	}
	if len(name) > 120 {
		name = name[:120]
	}
	return name
}

func detectKind(entry Entry) string {
	if entry.App() != "" {
		return "site"
	}
	for _, file := range entry.Files {
		if isDocPath(file.Path) {
			return "docs"
		}
	}
	if len(entry.Files) == 1 {
		return "file"
	}
	return "files"
}

func isDocPath(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".md", ".markdown", ".mdown", ".txt", ".rst", ".adoc":
		return true
	}
	return false
}

func isHTMLPath(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".html", ".htm":
		return true
	}
	return false
}

func validID(id string) bool {
	if len(id) != 18 || !strings.HasPrefix(id, "d-") {
		return false
	}
	for _, r := range id[2:] {
		if !strings.ContainsRune("0123456789abcdef", r) {
			return false
		}
	}
	return true
}
