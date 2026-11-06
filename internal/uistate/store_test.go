package uistate

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStorePersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ui-state.json")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetHidden([]string{"b", "a"}, true); err != nil {
		t.Fatal(err)
	}
	if err := store.SetStatus("b", "done"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetStatus("c", "failed"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetDraft("ses_b", "long prompt"); err != nil {
		t.Fatal(err)
	}
	if err := store.SetModel(&ModelRef{ID: "m", ProviderID: "p", Variant: "v"}); err != nil {
		t.Fatal(err)
	}
	if err := store.SetAgent("build"); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	state := reopened.Snapshot()
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

	if err := reopened.SetHidden([]string{"a"}, false); err != nil {
		t.Fatal(err)
	}
	if err := reopened.SetStatus("b", ""); err != nil {
		t.Fatal(err)
	}
	if err := reopened.Remove("c"); err != nil {
		t.Fatal(err)
	}
	state = reopened.Snapshot()
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

func TestOpenBrokenFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ui-state.json")
	if err := os.WriteFile(path, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path)
	if err == nil {
		t.Fatal("expected a parse error")
	}
	if store == nil {
		t.Fatal("expected a usable store")
	}
	if err := store.SetStatus("a", "done"); err != nil {
		t.Fatal(err)
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
