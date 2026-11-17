package server

import (
	"strings"
	"testing"
)

func TestSnippetAround(t *testing.T) {
	text := "Сегодня мы правили Sheets.kt и обсуждали кэш"
	lower := "сегодня мы правили sheets.kt и обсуждали кэш"
	got := snippetAround(text, lower, "sheets.kt")
	want := "Сегодня мы правили Sheets.kt и обсуждали кэш"
	if got != want {
		t.Fatalf("snippet = %q, want %q", got, want)
	}
	long := strings.Repeat("a", 400)
	got = snippetAround("aaaa"+long+"bbbb", "aaaa"+long+"bbbb", "zzz")
	if got != "" {
		t.Fatalf("miss = %q", got)
	}
}

func TestContentIndexFind(t *testing.T) {
	idx := &contentIndex{sessions: map[string]*sessionText{
		"ses_a": {
			directory: "/work/nit",
			updated:   2,
			messages: []textMessage{
				{created: 1, text: "старое", lower: "старое"},
				{created: 2, text: "Мобильное приложение без ассистента", lower: "мобильное приложение без ассистента"},
			},
		},
		"ses_b": {
			directory: "/work/other",
			updated:   3,
			messages:  []textMessage{{created: 1, text: "мобильное меню", lower: "мобильное меню"}},
		},
		"ses_c": {
			archived: true,
			updated:  4,
			messages: []textMessage{{created: 1, text: "мобильное старое", lower: "мобильное старое"}},
		},
	}}
	got := idx.find("Мобильн", "")
	if len(got) != 2 {
		t.Fatalf("matches = %d, want 2: %+v", len(got), got)
	}
	if got[0].ID != "ses_b" || got[1].ID != "ses_a" {
		t.Fatalf("order = %v,%v", got[0].ID, got[1].ID)
	}
	if got[1].Snippet == "" {
		t.Fatalf("missing snippet for ses_a")
	}
	if filtered := idx.find("мобильн", "/work/nit"); len(filtered) != 1 || filtered[0].ID != "ses_a" {
		t.Fatalf("directory filter = %+v", filtered)
	}
}
