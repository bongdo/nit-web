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
	ShortExpiry = 14 * 24 * time.Hour
	MetaName    = "entry.json"
)

var (
	ErrNotFound    = errors.New("drop entry not found")
	ErrSlugTaken   = errors.New("drop slug already in use")
	ErrInvalidSlug = errors.New("invalid drop slug")
)

type File struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

type Entry struct {
	ID      string     `json:"id"`
	Slug    string     `json:"slug"`
	Aliases []string   `json:"aliases,omitempty"`
	Name    string     `json:"name"`
	Kind    string     `json:"kind"`
	Public  bool       `json:"public"`
	Created time.Time  `json:"created"`
	Expires *time.Time `json:"expires,omitempty"`
	Files   []File     `json:"files"`
	Size    int64      `json:"size"`
	Service *Service   `json:"service,omitempty"`
}

type Service struct {
	Dir       string   `json:"dir"`
	Image     string   `json:"image,omitempty"`
	Container string   `json:"container,omitempty"`
	Cmd       []string `json:"cmd,omitempty"`
	Port      int      `json:"port,omitempty"`
	Health    string   `json:"health,omitempty"`
	HostPort  int      `json:"hostPort,omitempty"`
	Status    string   `json:"status,omitempty"`
	Revision  int64    `json:"revision,omitempty"`
	Stopped   bool     `json:"stopped,omitempty"`
}

func (e Entry) Expired(now time.Time) bool {
	return e.Expires != nil && !now.Before(*e.Expires)
}

func (e Entry) Forever() bool {
	return e.Expires == nil
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

func (e Entry) Text() string {
	if doc := e.Doc(); doc != "" {
		return doc
	}
	for _, file := range e.Files {
		if isReadableText(file.Path) {
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
	root     string
	mu       sync.Mutex
	now      func() time.Time
	onDelete func(Entry)
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
	store := &Store{root: root, now: time.Now}
	if err := store.migrate(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *Store) Root() string {
	return s.root
}

func (s *Store) SetDeleteHook(fn func(Entry)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onDelete = fn
}

func (s *Store) deleteLocked(entry Entry) error {
	if s.onDelete != nil {
		s.onDelete(entry)
	}
	return os.RemoveAll(filepath.Join(s.root, entry.ID))
}

func (s *Store) List() ([]Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.listLocked()
}

func (s *Store) listLocked() ([]Entry, error) {
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
			_ = s.deleteLocked(entry)
			continue
		}
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Created.After(entries[j].Created)
	})
	return entries, nil
}

func (s *Store) Get(ref string) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.resolveLocked(ref)
}

func (s *Store) GetBySlug(slug string) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.bySlugLocked(slug)
}

func (s *Store) resolveLocked(ref string) (Entry, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return Entry{}, ErrNotFound
	}
	if validID(ref) {
		entry, err := s.read(ref)
		if err == nil {
			return s.liveLocked(entry)
		}
		if !errors.Is(err, ErrNotFound) {
			return Entry{}, err
		}
	}
	return s.bySlugLocked(ref)
}

func (s *Store) bySlugLocked(slug string) (Entry, error) {
	slug = NormalizeSlug(slug)
	if slug == "" {
		return Entry{}, ErrNotFound
	}
	entries, err := s.listLocked()
	if err != nil {
		return Entry{}, err
	}
	for _, entry := range entries {
		if entry.Slug == slug || hasAlias(entry, slug) {
			return entry, nil
		}
	}
	return Entry{}, ErrNotFound
}

func (s *Store) liveLocked(entry Entry) (Entry, error) {
	if entry.Expired(s.now()) {
		_ = s.deleteLocked(entry)
		return Entry{}, ErrNotFound
	}
	return entry, nil
}

func (s *Store) Delete(ref string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, err := s.resolveLocked(ref)
	if err != nil {
		return err
	}
	return s.deleteLocked(entry)
}

func (s *Store) SetSlug(ref, slug string) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, err := s.resolveLocked(ref)
	if err != nil {
		return Entry{}, err
	}
	slug = NormalizeSlug(slug)
	if !validSlug(slug) {
		return Entry{}, ErrInvalidSlug
	}
	if slug == entry.Slug {
		return entry, nil
	}
	if s.slugTakenLocked(slug, entry.ID) {
		return Entry{}, ErrSlugTaken
	}
	old := entry.Slug
	entry.Aliases = removeAlias(entry.Aliases, slug)
	if old != "" && old != slug && !hasAlias(entry, old) {
		entry.Aliases = append(entry.Aliases, old)
	}
	entry.Slug = slug
	entry.Aliases = cleanAliases(entry.Aliases, entry.Slug)
	if err := s.writeEntry(entry); err != nil {
		return Entry{}, err
	}
	return entry, nil
}

func (s *Store) SetPublic(ref string, public bool) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, err := s.resolveLocked(ref)
	if err != nil {
		return Entry{}, err
	}
	entry.Public = public
	if err := s.writeEntry(entry); err != nil {
		return Entry{}, err
	}
	return entry, nil
}

func (s *Store) SetForever(ref string, forever bool) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, err := s.resolveLocked(ref)
	if err != nil {
		return Entry{}, err
	}
	if forever {
		entry.Expires = nil
	} else {
		expires := s.now().Add(ShortExpiry)
		entry.Expires = &expires
	}
	if err := s.writeEntry(entry); err != nil {
		return Entry{}, err
	}
	return entry, nil
}

func (s *Store) Update(ref string, edit func(*Entry)) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, err := s.resolveLocked(ref)
	if err != nil {
		return Entry{}, err
	}
	edit(&entry)
	if err := s.writeEntry(entry); err != nil {
		return Entry{}, err
	}
	return entry, nil
}

func (s *Store) CreateService(dir, name string, opts PublishOptions, service Service) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if name == "" {
		name = filepath.Base(filepath.Clean(dir))
	}
	id, entryDir, err := s.mkdir()
	if err != nil {
		return Entry{}, err
	}
	entry := Entry{
		ID:      id,
		Name:    cleanName(name),
		Kind:    "service",
		Public:  opts.Public,
		Created: s.now(),
		Service: &service,
	}
	if opts.TTL > 0 {
		expires := entry.Created.Add(opts.TTL)
		entry.Expires = &expires
	}
	if strings.TrimSpace(opts.Slug) != "" {
		slug := NormalizeSlug(opts.Slug)
		if !validSlug(slug) {
			_ = os.RemoveAll(entryDir)
			return Entry{}, ErrInvalidSlug
		}
		if s.slugTakenLocked(slug, "") {
			_ = os.RemoveAll(entryDir)
			return Entry{}, ErrSlugTaken
		}
		entry.Slug = slug
	} else {
		entry.Slug = s.uniqueSlugLocked(slugBase(entry))
	}
	if entry.Service.Container == "" {
		entry.Service.Container = containerName(entry.Slug)
	}
	if entry.Service.Port == 0 {
		entry.Service.Port = defaultServicePort
	}
	if entry.Service.Health == "" {
		entry.Service.Health = "/"
	}
	if err := s.writeEntry(entry); err != nil {
		_ = os.RemoveAll(entryDir)
		return Entry{}, err
	}
	return entry, nil
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

type PublishOptions struct {
	Slug   string
	Public bool
	TTL    time.Duration
}

func (s *Store) PublishPath(src, name string, opts PublishOptions) (Entry, error) {
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
	builder.SetSlug(opts.Slug)
	builder.SetPublic(opts.Public)
	builder.SetTTL(opts.TTL)
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
	entry = normalizeEntry(entry)
	return entry, nil
}

func (s *Store) writeEntry(entry Entry) error {
	data, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Join(s.root, entry.ID)
	tmp := filepath.Join(dir, ".entry.tmp")
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, MetaName))
}

func (s *Store) migrate() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	items, err := os.ReadDir(s.root)
	if err != nil {
		return err
	}
	entries := make([]Entry, 0, len(items))
	for _, item := range items {
		entry, err := s.read(item.Name())
		if err != nil {
			continue
		}
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Created.Equal(entries[j].Created) {
			return entries[i].ID < entries[j].ID
		}
		return entries[i].Created.Before(entries[j].Created)
	})
	used := map[string]string{}
	changed := map[string]bool{}
	for index := range entries {
		entry := entries[index]
		raw, rawErr := s.readRaw(entry.ID)
		if rawErr == nil {
			if raw.Expires != nil && raw.Expires.Sub(raw.Created) == 7*24*time.Hour {
				entry.Expires = nil
			}
			if raw.Expires != nil && raw.Expires.IsZero() {
				entry.Expires = nil
			}
			if raw.Kind != "service" {
				entry.Kind = detectKind(entry)
			}
			entry.Public = raw.Public
			entry.Name = cleanName(raw.Name)
		}
		if !validSlug(entry.Slug) || used[entry.Slug] != "" {
			entry.Slug = uniqueSlug(used, slugBase(entry))
		}
		used[entry.Slug] = entry.ID
		aliases := cleanAliases(entry.Aliases, entry.Slug)
		for _, alias := range aliases {
			if used[alias] == "" {
				used[alias] = entry.ID
			}
		}
		entry.Aliases = aliases
		if rawErr == nil && !sameEntryData(raw, entry) {
			changed[entry.ID] = true
		}
		entries[index] = entry
	}
	for _, entry := range entries {
		if changed[entry.ID] {
			if err := s.writeEntry(entry); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Store) readRaw(id string) (Entry, error) {
	if !validID(id) {
		return Entry{}, ErrNotFound
	}
	data, err := os.ReadFile(filepath.Join(s.root, id, MetaName))
	if err != nil {
		return Entry{}, err
	}
	var entry Entry
	if err := json.Unmarshal(data, &entry); err != nil {
		return Entry{}, err
	}
	return entry, nil
}

func normalizeEntry(entry Entry) Entry {
	entry.Slug = NormalizeSlug(entry.Slug)
	entry.Aliases = cleanAliases(entry.Aliases, entry.Slug)
	entry.Name = cleanName(entry.Name)
	if entry.Expires != nil && entry.Expires.IsZero() {
		entry.Expires = nil
	}
	if entry.Kind == "" {
		entry.Kind = detectKind(entry)
	}
	if entry.Kind == "files" || entry.Kind == "docs" {
		entry.Kind = detectKind(entry)
	}
	return entry
}

func (s *Store) slugTakenLocked(slug, exceptID string) bool {
	entries, err := s.listLocked()
	if err != nil {
		return true
	}
	for _, entry := range entries {
		if entry.ID == exceptID {
			continue
		}
		if entry.Slug == slug || hasAlias(entry, slug) {
			return true
		}
	}
	return false
}

func uniqueSlug(used map[string]string, base string) string {
	base = slugBaseValue(base)
	if used[base] == "" {
		return base
	}
	for index := 2; index < 1000; index++ {
		candidate := fmt.Sprintf("%s-%d", base, index)
		if used[candidate] == "" {
			return candidate
		}
	}
	return fmt.Sprintf("%s-%d", base, time.Now().UnixNano())
}

func slugBase(entry Entry) string {
	name := entry.Name
	if ext := path.Ext(name); ext != "" && strings.TrimSuffix(name, ext) != "" {
		name = strings.TrimSuffix(name, ext)
	}
	if value := Slugify(name); value != "" {
		return value
	}
	return entry.ID
}

func slugBaseValue(value string) string {
	value = Slugify(value)
	if value == "" {
		value = "drop"
	}
	return value
}

func Slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var out strings.Builder
	lastDash := false
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			out.WriteRune(r)
			lastDash = false
		case r == '-' || r == '_' || r == ' ' || r == '.':
			if !lastDash && out.Len() > 0 {
				out.WriteByte('-')
				lastDash = true
			}
		}
		limit := 60
		if out.Len() >= limit {
			break
		}
	}
	return strings.Trim(out.String(), "-")
}

func NormalizeSlug(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func validSlug(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
		default:
			return false
		}
	}
	return value[0] != '-' && value[len(value)-1] != '-'
}

func hasAlias(entry Entry, slug string) bool {
	for _, alias := range entry.Aliases {
		if alias == slug {
			return true
		}
	}
	return false
}

func removeAlias(aliases []string, slug string) []string {
	out := aliases[:0]
	for _, alias := range aliases {
		if alias != slug {
			out = append(out, alias)
		}
	}
	return out
}

func cleanAliases(aliases []string, canonical string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(aliases))
	for _, alias := range aliases {
		alias = NormalizeSlug(alias)
		if !validSlug(alias) || alias == canonical {
			continue
		}
		if _, ok := seen[alias]; ok {
			continue
		}
		seen[alias] = struct{}{}
		out = append(out, alias)
	}
	sort.Strings(out)
	return out
}

func sameEntryData(left, right Entry) bool {
	leftData, leftErr := json.Marshal(left)
	rightData, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && string(leftData) == string(rightData)
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
	store   *Store
	entry   Entry
	dir     string
	seen    map[string]struct{}
	ttl     time.Duration
	slug    string
	slugSet bool
	closed  bool
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
		entry: Entry{
			ID:      id,
			Name:    cleanName(name),
			Created: s.now(),
		},
	}, nil
}

func (b *Builder) SetName(name string) {
	b.entry.Name = cleanName(name)
}

func (b *Builder) SetSlug(slug string) {
	b.slug = NormalizeSlug(slug)
	b.slugSet = strings.TrimSpace(slug) != ""
}

func (b *Builder) SetPublic(public bool) {
	b.entry.Public = public
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
		expires := b.entry.Created.Add(b.ttl)
		b.entry.Expires = &expires
	}
	b.store.mu.Lock()
	defer b.store.mu.Unlock()
	if b.slugSet {
		if !validSlug(b.slug) {
			b.Abort()
			return Entry{}, ErrInvalidSlug
		}
		if b.store.slugTakenLocked(b.slug, b.entry.ID) {
			b.Abort()
			return Entry{}, ErrSlugTaken
		}
		b.entry.Slug = b.slug
	} else {
		b.entry.Slug = b.store.uniqueSlugLocked(slugBase(b.entry))
	}
	if err := b.store.writeEntry(b.entry); err != nil {
		b.Abort()
		return Entry{}, err
	}
	return b.entry, nil
}

func (s *Store) uniqueSlugLocked(base string) string {
	base = slugBaseValue(base)
	if !s.slugTakenLocked(base, "") {
		return base
	}
	for index := 2; index < 1000; index++ {
		candidate := fmt.Sprintf("%s-%d", base, index)
		if !s.slugTakenLocked(candidate, "") {
			return candidate
		}
	}
	return fmt.Sprintf("%s-%d", base, time.Now().UnixNano())
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
	if strings.HasPrefix(rel, "/") {
		return "", errors.New("invalid drop path")
	}
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
	if entry.Kind == "service" {
		return "service"
	}
	if entry.App() != "" {
		return "site"
	}
	if len(entry.Files) == 1 {
		return "file"
	}
	return "collection"
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

func isReadableText(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".md", ".markdown", ".mdown", ".txt", ".rst", ".adoc", ".log",
		".json", ".yaml", ".yml", ".toml", ".csv", ".ini", ".conf", ".comf",
		".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css",
		".py", ".rs", ".rb", ".sh", ".bash", ".zsh", ".sql", ".xml":
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
