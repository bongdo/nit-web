package uistate

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestStorePersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ui-state.json")
	store, err := Open(path, "frankfurt")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetHidden("frankfurt", []string{"b", "a"}, true); err != nil {
		t.Fatal(err)
	}
	if err := store.SetStatus("frankfurt", "b", "done"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetStatus("frankfurt", "c", "failed"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetDraft("frankfurt", "ses_b", "long prompt"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetModel("frankfurt", &ModelRef{ID: "m", ProviderID: "p", Variant: "v"}); err != nil {
		t.Fatal(err)
	}
	if err := store.SetAgent("frankfurt", "build"); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(path, "frankfurt")
	if err != nil {
		t.Fatal(err)
	}
	state := reopened.Snapshot("frankfurt")
	if len(state.Hidden) != 2 || state.Hidden[0] != "a" || state.Hidden[1] != "b" {
		t.Fatalf("hidden = %v", state.Hidden)
	}
	if state.Status["b"] != "done" || state.Status["c"] != "failed" {
		t.Fatalf("status = %v", state.Status)
	}
	if state.Drafts["ses_b"].Text != "long prompt" || state.Drafts["ses_b"].UpdatedAt == 0 {
		t.Fatalf("drafts = %+v", state.Drafts)
	}
	if state.Model == nil || state.Model.ID != "m" || state.Model.Variant != "v" || state.Agent != "build" {
		t.Fatalf("preferences = %+v / %q", state.Model, state.Agent)
	}

	if err := reopened.SetHidden("frankfurt", []string{"a"}, false); err != nil {
		t.Fatal(err)
	}
	if err := reopened.SetStatus("frankfurt", "b", ""); err != nil {
		t.Fatal(err)
	}
	if err := reopened.Remove("frankfurt", "c"); err != nil {
		t.Fatal(err)
	}
	state = reopened.Snapshot("frankfurt")
	if len(state.Hidden) != 1 || state.Hidden[0] != "b" {
		t.Fatalf("hidden after removal = %v", state.Hidden)
	}
	if len(state.Status) != 0 {
		t.Fatalf("status after removal = %v", state.Status)
	}
	if mode := fileMode(t, path); mode != 0o600 {
		t.Fatalf("state file mode = %o", mode)
	}
}

func TestOpenMigratesLegacyState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ui-state.json")
	legacy := `{
  "hidden": ["a"],
  "status": {"b": "done"},
  "drafts": {"k": {"text": "t", "updatedAt": 1}},
  "model": {"id": "m", "providerID": "p", "variant": "v"},
  "agent": "build"
}`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path, "frankfurt")
	if err != nil {
		t.Fatal(err)
	}
	state := store.Snapshot("frankfurt")
	if len(state.Hidden) != 1 || state.Hidden[0] != "a" || state.Status["b"] != "done" {
		t.Fatalf("migrated state = %+v", state)
	}
	if state.Drafts["k"].Text != "t" || state.Model == nil || state.Model.ID != "m" || state.Agent != "build" {
		t.Fatalf("migrated preferences = %+v", state)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var saved map[string]any
	if err := json.Unmarshal(raw, &saved); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"hidden", "status", "drafts", "model", "agent"} {
		if _, ok := saved[field]; ok {
			t.Fatalf("legacy field %q still saved: %s", field, raw)
		}
	}
	instances, ok := saved["instances"].(map[string]any)
	if !ok || instances["frankfurt"] == nil {
		t.Fatalf("saved instances = %v", saved["instances"])
	}

	fallback, err := Open(path, "")
	if err != nil {
		t.Fatal(err)
	}
	if state := fallback.Snapshot("frankfurt"); len(state.Hidden) != 1 {
		t.Fatalf("reopened state = %+v", state)
	}
}

func TestOpenMigratesLegacyStateToLocal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ui-state.json")
	if err := os.WriteFile(path, []byte(`{"agent":"build"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path, "")
	if err != nil {
		t.Fatal(err)
	}
	if state := store.Snapshot("local"); state.Agent != "build" {
		t.Fatalf("local state = %+v", state)
	}
}

func TestInstancesAreIsolated(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ui-state.json")
	store, err := Open(path, "a")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetHidden("a", []string{"x"}, true); err != nil {
		t.Fatal(err)
	}
	if err := store.SetStatus("a", "x", "done"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetDraft("a", "x", "draft a"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetModel("a", &ModelRef{ID: "ma", ProviderID: "pa"}); err != nil {
		t.Fatal(err)
	}
	if err := store.SetAgent("a", "build"); err != nil {
		t.Fatal(err)
	}

	b := store.Snapshot("b")
	if len(b.Hidden) != 0 || len(b.Status) != 0 || len(b.Drafts) != 0 || b.Model != nil || b.Agent != "" {
		t.Fatalf("instance b leaked state: %+v", b)
	}
	if b.Hidden == nil || b.Status == nil || b.Drafts == nil {
		t.Fatalf("instance b has nil collections: %+v", b)
	}

	if err := store.SetHidden("b", []string{"y"}, true); err != nil {
		t.Fatal(err)
	}
	if err := store.SetStatus("b", "y", "failed"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetDraft("b", "y", "draft b"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetModel("b", &ModelRef{ID: "mb", ProviderID: "pb"}); err != nil {
		t.Fatal(err)
	}
	if err := store.SetAgent("b", "plan"); err != nil {
		t.Fatal(err)
	}

	a := store.Snapshot("a")
	if len(a.Hidden) != 1 || a.Hidden[0] != "x" || a.Status["x"] != "done" {
		t.Fatalf("instance a changed: %+v", a)
	}
	if a.Drafts["x"].Text != "draft a" || a.Model == nil || a.Model.ID != "ma" || a.Agent != "build" {
		t.Fatalf("instance a preferences changed: %+v", a)
	}
	if len(a.Status) != 1 || len(a.Drafts) != 1 {
		t.Fatalf("instance a collections changed: %+v", a)
	}
}

func TestStoreShowHiddenPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ui-state.json")
	store, err := Open(path, "frankfurt")
	if err != nil {
		t.Fatal(err)
	}
	if store.Snapshot("frankfurt").ShowHidden {
		t.Fatal("showHidden defaults to true")
	}
	if err := store.SetShowHidden("frankfurt", true); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path, "frankfurt")
	if err != nil {
		t.Fatal(err)
	}
	if !reopened.Snapshot("frankfurt").ShowHidden {
		t.Fatal("showHidden did not persist")
	}
	if reopened.Snapshot("riga").ShowHidden {
		t.Fatal("showHidden leaked to another instance")
	}
	if err := reopened.SetShowHidden("frankfurt", false); err != nil {
		t.Fatal(err)
	}
	if reopened.Snapshot("frankfurt").ShowHidden {
		t.Fatal("showHidden did not reset")
	}
}

func TestOpenBrokenFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ui-state.json")
	if err := os.WriteFile(path, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path, "frankfurt")
	if err == nil {
		t.Fatal("expected a parse error")
	}
	if store == nil {
		t.Fatal("expected a usable store")
	}
	if err := store.SetStatus("frankfurt", "a", "done"); err != nil {
		t.Fatal(err)
	}
	if store.state.Instances == nil {
		t.Fatal("expected initialized instances")
	}
}

func fileMode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.Mode().Perm()
}

func TestClearDraftKeepsTombstone(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := Open(path, "local")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetDraft("local", "key", "hello"); err != nil {
		t.Fatal(err)
	}
	cleared, err := store.SetDraft("local", "key", "")
	if err != nil {
		t.Fatal(err)
	}
	if !cleared.Cleared || cleared.Text != "" || cleared.UpdatedAt == 0 {
		t.Fatalf("clear draft = %+v", cleared)
	}
	got := store.Draft("local", "key")
	if !got.Cleared || got.UpdatedAt != cleared.UpdatedAt {
		t.Fatalf("stored tombstone = %+v", got)
	}
	reopened, err := Open(path, "local")
	if err != nil {
		t.Fatal(err)
	}
	if got := reopened.Draft("local", "key"); !got.Cleared {
		t.Fatalf("reopened tombstone = %+v", got)
	}
}

func TestCorruptStateIsPreserved(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path, "local")
	if err == nil {
		t.Fatal("expected a parse error")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("corrupt file was not moved: %v", err)
	}
	matches, err := filepath.Glob(path + ".corrupt-*")
	if err != nil || len(matches) != 1 {
		t.Fatalf("corrupt backups = %v, %v", matches, err)
	}
	if _, err := store.SetDraft("local", "key", "new"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("new state was not written: %v", err)
	}
}

func TestRenameMovesInstanceState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := Open(path, "local")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetDraft("local", "key", "hello"); err != nil {
		t.Fatal(err)
	}
	if !store.Has("local") || store.Has("office") {
		t.Fatalf("unexpected Has before rename: %v %v", store.Has("local"), store.Has("office"))
	}
	if err := store.Rename("local", "office"); err != nil {
		t.Fatal(err)
	}
	if store.Has("local") || !store.Has("office") {
		t.Fatalf("unexpected Has after rename: %v %v", store.Has("local"), store.Has("office"))
	}
	if got := store.Draft("office", "key").Text; got != "hello" {
		t.Fatalf("draft = %q", got)
	}
	reopened, err := Open(path, "local")
	if err != nil {
		t.Fatal(err)
	}
	if got := reopened.Draft("office", "key").Text; got != "hello" {
		t.Fatalf("reopened draft = %q", got)
	}
	if err := reopened.Rename("office", "local"); err != nil {
		t.Fatal(err)
	}
}
