package drop

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func writeFile(t *testing.T, name, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(name), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func publishFile(t *testing.T, store *Store, name, content string, opts PublishOptions) Entry {
	t.Helper()
	src := filepath.Join(t.TempDir(), name)
	writeFile(t, src, content)
	entry, err := store.PublishPath(src, strings.TrimSuffix(name, filepath.Ext(name)), opts)
	if err != nil {
		t.Fatal(err)
	}
	return entry
}

func TestPublishAndList(t *testing.T) {
	store := testStore(t)
	src := t.TempDir()
	writeFile(t, filepath.Join(src, "index.md"), "# hello")
	writeFile(t, filepath.Join(src, "sub", "other.md"), "other")

	entry, err := store.PublishPath(src, "docs", PublishOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if entry.Slug != "docs" || entry.Public || !entry.Forever() || entry.Kind != "collection" || entry.Doc() != "index.md" {
		t.Fatalf("entry = %+v", entry)
	}
	if entry.Size == 0 || len(entry.Files) != 2 {
		t.Fatalf("files = %+v", entry.Files)
	}
	items, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != entry.ID {
		t.Fatalf("list = %+v", items)
	}
	for _, ref := range []string{entry.ID, entry.Slug} {
		if _, err := store.Get(ref); err != nil {
			t.Fatalf("get %q: %v", ref, err)
		}
	}
	if _, err := store.GetBySlug(entry.Slug); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(entry.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(entry.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("get after delete = %v", err)
	}
}

func TestSiteAndSingleFileKinds(t *testing.T) {
	store := testStore(t)
	site := t.TempDir()
	writeFile(t, filepath.Join(site, "index.html"), "<!doctype html>")
	entry, err := store.PublishPath(site, "site", PublishOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if entry.Kind != "site" || entry.App() != "index.html" {
		t.Fatalf("site = %+v", entry)
	}

	file := filepath.Join(t.TempDir(), "report.pdf")
	writeFile(t, file, "%PDF")
	entry, err = store.PublishPath(file, "", PublishOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if entry.Kind != "file" || len(entry.Files) != 1 || entry.Slug != "report" {
		t.Fatalf("file = %+v", entry)
	}
}

func TestExpiredEntriesArePruned(t *testing.T) {
	store := testStore(t)
	src := t.TempDir()
	writeFile(t, filepath.Join(src, "a.txt"), "a")
	entry, err := store.PublishPath(src, "short", PublishOptions{TTL: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	store.now = func() time.Time { return time.Now().Add(2 * time.Minute) }
	items, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("expired entry survived: %+v", items)
	}
	if _, err := os.Stat(filepath.Join(store.Root(), entry.ID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("expired entry directory was not removed")
	}
}

func TestUnsafePaths(t *testing.T) {
	for _, name := range []string{"../x", "/etc/passwd", `..\x`, "a/../../b", MetaName, ".entry.tmp", "a:b"} {
		if _, err := safeRel(name); err == nil {
			t.Errorf("safeRel(%q) accepted", name)
		}
	}
	if got, err := safeRel("sub/a.md"); err != nil || got != "sub/a.md" {
		t.Fatalf("safeRel = %q, %v", got, err)
	}
}

func TestParseTTL(t *testing.T) {
	cases := map[string]time.Duration{
		"":    0,
		"1h":  time.Hour,
		"7d":  7 * 24 * time.Hour,
		"2w":  14 * 24 * time.Hour,
		"0":   0,
		"24h": 24 * time.Hour,
	}
	for raw, want := range cases {
		got, err := ParseTTL(raw)
		if err != nil || got != want {
			t.Errorf("ParseTTL(%q) = %v, %v; want %v", raw, got, err, want)
		}
	}
	for _, raw := range []string{"-1h", "nope"} {
		if _, err := ParseTTL(raw); err == nil {
			t.Errorf("ParseTTL(%q) accepted", raw)
		}
	}
}

func TestBuilderDeduplicatesNames(t *testing.T) {
	store := testStore(t)
	builder, err := store.NewEntry("upload")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"a.txt", "a.txt"} {
		if err := builder.AddFile(name, strings.NewReader("x")); err != nil {
			t.Fatal(err)
		}
	}
	entry, err := builder.Commit()
	if err != nil {
		t.Fatal(err)
	}
	if len(entry.Files) != 2 || entry.Files[0].Path != "a-2.txt" || entry.Files[1].Path != "a.txt" {
		t.Fatalf("files = %+v", entry.Files)
	}
}

func TestSlugAliasesAndUniqueness(t *testing.T) {
	store := testStore(t)
	first := publishFile(t, store, "one.txt", "one", PublishOptions{})
	second := publishFile(t, store, "two.txt", "two", PublishOptions{})

	entry, err := store.SetSlug(first.ID, "alpha")
	if err != nil {
		t.Fatal(err)
	}
	if entry.Slug != "alpha" || !hasAlias(entry, "one") {
		t.Fatalf("after first rename = %+v", entry)
	}
	if _, err := store.GetBySlug("one"); err != nil {
		t.Fatalf("old slug did not resolve: %v", err)
	}

	entry, err = store.SetSlug(first.ID, "beta")
	if err != nil {
		t.Fatal(err)
	}
	if entry.Slug != "beta" || !hasAlias(entry, "alpha") || !hasAlias(entry, "one") {
		t.Fatalf("after second rename = %+v", entry)
	}
	if _, err := store.GetBySlug("alpha"); err != nil {
		t.Fatalf("alias did not resolve: %v", err)
	}

	if _, err := store.SetSlug(second.ID, "beta"); !errors.Is(err, ErrSlugTaken) {
		t.Fatalf("duplicate canonical slug = %v", err)
	}
	if _, err := store.SetSlug(second.ID, "one"); !errors.Is(err, ErrSlugTaken) {
		t.Fatalf("duplicate alias = %v", err)
	}
	if _, err := store.SetSlug(second.ID, "Bad Slug"); !errors.Is(err, ErrInvalidSlug) {
		t.Fatalf("invalid slug = %v", err)
	}
	for _, reserved := range []string{"api", "e", "files", "download", "static"} {
		if _, err := store.SetSlug(second.ID, reserved); !errors.Is(err, ErrInvalidSlug) {
			t.Fatalf("reserved slug %q = %v", reserved, err)
		}
	}

	src := filepath.Join(t.TempDir(), "three.txt")
	writeFile(t, src, "three")
	if _, err := store.PublishPath(src, "three", PublishOptions{Slug: "beta"}); !errors.Is(err, ErrSlugTaken) {
		t.Fatalf("publish with taken slug = %v", err)
	}

	reopened, err := Open(store.Root())
	if err != nil {
		t.Fatal(err)
	}
	got, err := reopened.GetBySlug("one")
	if err != nil || got.ID != first.ID {
		t.Fatalf("alias after reopen = %+v, %v", got, err)
	}
}

func TestSetPublicAndForever(t *testing.T) {
	store := testStore(t)
	entry := publishFile(t, store, "note.txt", "note", PublishOptions{})
	if entry.Public || !entry.Forever() {
		t.Fatalf("defaults = %+v", entry)
	}
	entry, err := store.SetPublic(entry.ID, true)
	if err != nil || !entry.Public {
		t.Fatalf("public = %+v, %v", entry, err)
	}
	before := time.Now()
	entry, err = store.SetForever(entry.ID, false)
	if err != nil || entry.Expires == nil {
		t.Fatalf("expires = %+v, %v", entry, err)
	}
	if delta := entry.Expires.Sub(before); delta < ShortExpiry-time.Minute || delta > ShortExpiry+time.Minute {
		t.Fatalf("expiry delta = %v", delta)
	}
	entry, err = store.SetForever(entry.ID, true)
	if err != nil || !entry.Forever() {
		t.Fatalf("forever = %+v, %v", entry, err)
	}
}

func TestMigration(t *testing.T) {
	root := t.TempDir()
	created := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	writeLegacy(t, root, "d-0123456789abcdef", "Old Report", created, created.Add(7*24*time.Hour), "a.txt")
	writeLegacy(t, root, "d-abcdef0123456789", "Keep Me", created.Add(time.Hour), created.Add(time.Hour+30*24*time.Hour), "b.txt")

	store, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	old, err := store.Get("d-0123456789abcdef")
	if err != nil {
		t.Fatal(err)
	}
	if old.Slug != "old-report" || old.Public || !old.Forever() || old.Kind != "file" {
		t.Fatalf("migrated default TTL = %+v", old)
	}
	keep, err := store.Get("d-abcdef0123456789")
	if err != nil {
		t.Fatal(err)
	}
	if keep.Slug != "keep-me" || keep.Forever() {
		t.Fatalf("migrated explicit TTL = %+v", keep)
	}
	if keep.Expires.Sub(keep.Created) != 30*24*time.Hour {
		t.Fatalf("explicit expiry changed: created=%v expires=%v delta=%v", keep.Created, keep.Expires, keep.Expires.Sub(keep.Created))
	}
}

func writeLegacy(t *testing.T, root, id, name string, created, expires time.Time, file string) {
	t.Helper()
	dir := filepath.Join(root, id)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, file), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{
  "id": %q,
  "name": %q,
  "kind": "files",
  "created": %q,
  "expires": %q,
  "files": [{"path": %q, "size": 1}],
  "size": 1
}`, id, name, created.Format(time.RFC3339Nano), expires.Format(time.RFC3339Nano), file)
	if err := os.WriteFile(filepath.Join(dir, MetaName), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestReadOnlyStoreKeepsExpiredEntries(t *testing.T) {
	root := t.TempDir()
	id := "d-0123456789abcdef"
	dir := filepath.Join(root, id)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-time.Hour)
	body, err := json.Marshal(Entry{ID: id, Slug: "old", Name: "old", Kind: "site", Expires: &past})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, MetaName), body, 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := OpenReadOnly(root)
	if err != nil {
		t.Fatal(err)
	}
	items, err := store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("expired entries listed = %d, want 0", len(items))
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("read-only list deleted the entry: %v", err)
	}
}
