package server

import (
	"os"
	"path/filepath"
	"testing"
)

func writeSpeechDictionary(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestSpeechDictionaryRewrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "speech.json")
	writeSpeechDictionary(t, path, `{
		"vault": "волт",
		"nit-gui": "нит гуи",
		"commit": "коммит",
		"pull request": "пул реквест",
		"": "пустое"
	}`)
	dict := newSpeechDictionary(path)
	cases := map[string]string{
		"Положи в vault.":              "Положи в волт.",
		"Открой Vault и nit-gui.":      "Открой волт и нит гуи.",
		"Один commit, второй commit.":  "Один коммит, второй коммит.",
		"Сделай pull request сегодня.": "Сделай пул реквест сегодня.",
		"Vaulting остаётся словом.":    "Vaulting остаётся словом.",
		"Ничего не меняется.":          "Ничего не меняется.",
	}
	for in, want := range cases {
		if got := dict.rewrite(in); got != want {
			t.Fatalf("rewrite(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSpeechDictionaryReloads(t *testing.T) {
	path := filepath.Join(t.TempDir(), "speech.json")
	writeSpeechDictionary(t, path, `{"vault": "волт"}`)
	dict := newSpeechDictionary(path)
	if got := dict.rewrite("vault"); got != "волт" {
		t.Fatalf("first = %q", got)
	}
	writeSpeechDictionary(t, path, `{"vault": "хранилище"}`)
	if got := dict.rewrite("vault"); got != "хранилище" {
		t.Fatalf("reload = %q", got)
	}
}

func TestSpeechDictionaryMissingFile(t *testing.T) {
	dict := newSpeechDictionary(filepath.Join(t.TempDir(), "missing.json"))
	if got := dict.rewrite("vault"); got != "vault" {
		t.Fatalf("missing = %q", got)
	}
}
