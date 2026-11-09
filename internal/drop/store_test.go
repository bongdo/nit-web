package drop

import (
	"errors"
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

func TestPublishAndList(t *testing.T) {
	store := testStore(t)
	src := t.TempDir()
	writeFile(t, filepath.Join(src, "index.md"), "# hello")
	writeFile(t, filepath.Join(src, "sub", "other.md"), "other")

	entry, err := store.PublishPath(src, "docs", 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Kind != "docs" || entry.Doc() != "index.md" {
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
	if _, err := store.Get(entry.ID); err != nil {
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
	entry, err := store.PublishPath(site, "site", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Kind != "site" || entry.App() != "index.html" {
		t.Fatalf("site = %+v", entry)
	}

	file := filepath.Join(t.TempDir(), "report.pdf")
	writeFile(t, file, "%PDF")
	entry, err = store.PublishPath(file, "", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Kind != "file" || len(entry.Files) != 1 {
		t.Fatalf("file = %+v", entry)
	}
}

func TestExpiredEntriesArePruned(t *testing.T) {
	store := testStore(t)
	src := t.TempDir()
	writeFile(t, filepath.Join(src, "a.txt"), "a")
	entry, err := store.PublishPath(src, "short", time.Minute)
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
		"":    DefaultTTL,
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
