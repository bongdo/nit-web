package server

import "testing"

func TestReviewPath(t *testing.T) {
	cases := []struct {
		name string
		dir  string
		ok   bool
	}{
		{"absolute", "/work/app", true},
		{"empty", "", false},
		{"relative", "work/app", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path, ok := reviewPath(tc.dir)
			if ok != tc.ok {
				t.Fatalf("ok = %v, want %v", ok, tc.ok)
			}
			if ok && path != "/work/app/docs/review/queue.json" {
				t.Fatalf("path = %q", path)
			}
		})
	}
}

func TestDocPath(t *testing.T) {
	cases := []struct {
		name string
		dir  string
		rel  string
		ok   bool
		want string
	}{
		{"vault", "/work/app", "vault/index.md", true, "/work/app/vault/index.md"},
		{"docs", "/work/app", "docs/review/queue.json", true, "/work/app/docs/review/queue.json"},
		{"traversal", "/work/app", "vault/../secret", false, ""},
		{"absolute rel", "/work/app", "/etc/passwd", false, ""},
		{"outside", "/work/app", "web/src/App.tsx", false, ""},
		{"prefix trick", "/work/app", "vaultx/a.md", false, ""},
		{"empty rel", "/work/app", "", false, ""},
		{"empty dir", "", "vault/a.md", false, ""},
		{"relative dir", "work", "vault/a.md", false, ""},
		{"nested traversal", "/work/app", "docs/../../etc/passwd", false, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path, ok := docPath(tc.dir, tc.rel)
			if ok != tc.ok {
				t.Fatalf("ok = %v, want %v", ok, tc.ok)
			}
			if ok && path != tc.want {
				t.Fatalf("path = %q, want %q", path, tc.want)
			}
		})
	}
}
