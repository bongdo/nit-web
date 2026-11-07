package server

import "testing"

func TestSafeNextRejectsRedirects(t *testing.T) {
	cases := map[string]string{
		"":             "/nit/",
		"/\\evil.com":  "/nit/",
		"//evil.com":   "/nit/",
		"%5C":          "/nit/",
		"/nit/chat":    "/nit/chat",
		"/chat":        "/nit/chat",
		"/\tevil.com":  "/nit/",
		"/nit/../chat": "/nit/../chat",
	}
	for raw, want := range cases {
		if got := safeNext(raw, "/nit"); got != want {
			t.Errorf("safeNext(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestSafeNextWithoutBase(t *testing.T) {
	if got := safeNext("/chat", ""); got != "/chat" {
		t.Fatalf("safeNext(/chat) = %q", got)
	}
	if got := safeNext("/\\evil.com", ""); got != "/" {
		t.Fatalf("backslash accepted: %q", got)
	}
	if got := safeNext("//evil.com", ""); got != "/" {
		t.Fatalf("scheme-relative URL accepted: %q", got)
	}
}
