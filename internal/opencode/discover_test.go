package opencode

import "testing"

func TestNormalizeServerURL(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"http://0.0.0.0:49374", "http://127.0.0.1:49374"},
		{"http://[::]:49374/", "http://[::1]:49374"},
		{"http://user:pass@127.0.0.1:49374/", "http://127.0.0.1:49374"},
		{"https://example.com/", "https://example.com:443"},
		{"http://127.0.0.1:49374/base/", "http://127.0.0.1:49374/base"},
	}
	for _, tc := range cases {
		got, err := normalizeServerURL(tc.in)
		if err != nil {
			t.Fatalf("normalizeServerURL(%q): %v", tc.in, err)
		}
		if got != tc.want {
			t.Fatalf("normalizeServerURL(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestNormalizeServerURLRejectsBadInput(t *testing.T) {
	for _, in := range []string{"", "ftp://example.com", "example.com", "http://"} {
		if _, err := normalizeServerURL(in); err == nil {
			t.Fatalf("normalizeServerURL(%q) did not fail", in)
		}
	}
}
