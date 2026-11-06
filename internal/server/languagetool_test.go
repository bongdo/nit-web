package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
)

func TestGrammarLanguage(t *testing.T) {
	cases := []struct {
		text string
		want string
		ok   bool
	}{
		{"добавь проверку", "ru-RU", true},
		{"add a check", "en-US", true},
		{"добавь в Composer.tsx проверку", "ru-RU", true},
		{"bin/check and Composer.tsx", "en-US", true},
		{"123 !!!", "", false},
	}
	for _, item := range cases {
		got, ok := grammarLanguage(item.text)
		if got != item.want || ok != item.ok {
			t.Fatalf("grammarLanguage(%q) = %q, %v; want %q, %v", item.text, got, ok, item.want, item.ok)
		}
	}
}

func TestGrammarCheckFiltersNoise(t *testing.T) {
	var mu sync.Mutex
	var form url.Values
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/languages":
			_, _ = w.Write([]byte(`[]`))
		case "/v2/check":
			_ = r.ParseForm()
			mu.Lock()
			form = r.PostForm
			mu.Unlock()
			_, _ = w.Write([]byte(`{"matches":[
				{"offset":0,"length":2,"message":"case","rule":{"id":"UPPERCASE_SENTENCE_START"},"replacements":[{"value":"Он"}]},
				{"offset":2,"length":4,"message":"spell","rule":{"id":"MORFOLOGIK_RULE_RU_RU"},"replacements":[{"value":"хочу"}]},
				{"offset":29,"length":11,"message":"comma","rule":{"id":"A_NO_DA"},"replacements":[{"value":"проверку, но"}]}
			]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer fake.Close()
	t.Setenv("NIT_GUI_LANGUAGETOOL_URL", fake.URL)
	t.Setenv("NIT_GUI_LANGUAGETOOL_PREWARM", "0")

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	checker := newGrammarChecker(logger)
	matches, err := checker.check(context.Background(),
		"он сказал что нужно добавить проверку но я не уверен")
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 || matches[0].RuleID != "A_NO_DA" {
		t.Fatalf("matches = %#v", matches)
	}
	if matches[0].Replacements[0] != "проверку, но" {
		t.Fatalf("replacements = %#v", matches[0].Replacements)
	}
	mu.Lock()
	defer mu.Unlock()
	if form.Get("language") != "ru-RU" {
		t.Fatalf("language = %q", form.Get("language"))
	}
	if !strings.Contains(form.Get("disabledRules"), "MORFOLOGIK_RULE_RU_RU") {
		t.Fatalf("disabledRules = %q", form.Get("disabledRules"))
	}
}

func TestGrammarHandler(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v2/languages" {
			_, _ = w.Write([]byte(`[]`))
			return
		}
		_, _ = w.Write([]byte(`{"matches":[{"offset":0,"length":7,"message":"too","rule":{"id":"TOO_TO"},"replacements":[{"value":"to add"}]}]}`))
	}))
	defer fake.Close()
	t.Setenv("NIT_GUI_LANGUAGETOOL_URL", fake.URL)
	t.Setenv("NIT_GUI_LANGUAGETOOL_PREWARM", "0")

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	s := &Server{grammar: newGrammarChecker(logger), log: logger}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/grammar",
		strings.NewReader(`{"text":"too add a check"}`))
	s.grammarCheck(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Matches []grammarMatch `json:"matches"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Matches) != 1 || out.Matches[0].RuleID != "TOO_TO" {
		t.Fatalf("out = %#v", out)
	}
}
