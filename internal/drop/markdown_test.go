package drop

import (
	"strings"
	"testing"
)

func TestMarkdownRewritesRelativeLinks(t *testing.T) {
	entry := Entry{
		ID: "d-0123456789abcdef",
		Files: []File{
			{Path: "notes.md"},
			{Path: "other.md"},
			{Path: "sub/guide.md"},
			{Path: "img/pic one.png"},
		},
	}
	src := []byte(strings.Join([]string{
		"[other](other.md)",
		"[guide](sub/guide.md#start)",
		"[up](../evil.md)",
		"[ext](https://example.com/a?b=1)",
		"[js](javascript:alert(1))",
		"![pic](img/pic%20one.png)",
		"![remote](https://example.com/p.png)",
	}, "\n\n"))
	out, err := renderMarkdown(entry, "notes.md", src, "../../files/"+entry.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`href="?file=other.md"`,
		`href="?file=sub%2Fguide.md#start"`,
		`href="#"`,
		`href="https://example.com/a?b=1"`,
		`src="../../files/d-0123456789abcdef/img/pic%20one.png"`,
		`src="https://example.com/p.png"`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
	if strings.Contains(out, "evil.md") || strings.Contains(out, "javascript:") {
		t.Fatalf("unsafe link survived:\n%s", out)
	}
}

func TestResolveRelRejectsTraversal(t *testing.T) {
	for _, value := range []string{"../x", "../../etc/passwd"} {
		if _, ok := resolveRel("a.md", value); ok {
			t.Errorf("resolveRel accepted %q", value)
		}
	}
	if got, ok := resolveRel("docs/a.md", "b.md"); !ok || got != "docs/b.md" {
		t.Fatalf("resolveRel = %q, %v", got, ok)
	}
	if got, ok := resolveRel("docs/a.md", "../x.md"); !ok || got != "x.md" {
		t.Fatalf("resolveRel parent = %q, %v", got, ok)
	}
	if got, ok := resolveRel("docs/a.md", "/root.md"); !ok || got != "root.md" {
		t.Fatalf("resolveRel root = %q, %v", got, ok)
	}
}
