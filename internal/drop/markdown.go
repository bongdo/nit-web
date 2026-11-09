package drop

import (
	"bytes"
	"net/url"
	"path"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

var markdown = goldmark.New(
	goldmark.WithExtensions(extension.GFM),
	goldmark.WithParserOptions(parser.WithAutoHeadingID()),
)

func renderMarkdown(entry Entry, rel string, src []byte, rawBase string) (string, error) {
	doc := markdown.Parser().Parse(text.NewReader(src))
	err := ast.Walk(doc, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch value := node.(type) {
		case *ast.Link:
			value.Destination = []byte(rewriteLink(string(value.Destination), rel, entry, rawBase))
		case *ast.Image:
			value.Destination = []byte(rewriteImage(string(value.Destination), rel, entry, rawBase))
		}
		return ast.WalkContinue, nil
	})
	if err != nil {
		return "", err
	}
	var out bytes.Buffer
	if err := markdown.Renderer().Render(&out, src, doc); err != nil {
		return "", err
	}
	return out.String(), nil
}

func rewriteLink(dest, from string, entry Entry, rawBase string) string {
	if dest == "" || strings.HasPrefix(dest, "#") {
		return dest
	}
	if unsafeURL(dest) {
		return "#"
	}
	if externalURL(dest) {
		return dest
	}
	target, suffix := splitSuffix(dest)
	clean, ok := resolveRel(from, target)
	if !ok {
		return "#"
	}
	if isDocPath(clean) || isReadableText(clean) {
		return "?file=" + url.QueryEscape(clean) + suffix
	}
	if entry.Has(clean) {
		return rawBase + "/" + escapePath(clean) + suffix
	}
	if doc := entry.docInDir(clean); doc != "" {
		return "?file=" + url.QueryEscape(doc) + suffix
	}
	return "?file=" + url.QueryEscape(clean) + suffix
}

func rewriteImage(dest, from string, entry Entry, rawBase string) string {
	if dest == "" {
		return dest
	}
	lower := strings.ToLower(dest)
	if strings.HasPrefix(lower, "data:") || strings.HasPrefix(lower, "blob:") {
		return dest
	}
	if unsafeURL(dest) {
		return ""
	}
	if externalURL(dest) {
		return dest
	}
	target, suffix := splitSuffix(dest)
	clean, ok := resolveRel(from, target)
	if !ok {
		return ""
	}
	return rawBase + "/" + escapePath(clean) + suffix
}

func resolveRel(from, target string) (string, bool) {
	if decoded, err := url.PathUnescape(target); err == nil {
		target = decoded
	}
	rooted := strings.HasPrefix(target, "/")
	target = strings.TrimPrefix(target, "/")
	base := path.Dir(from)
	if rooted {
		base = "."
	}
	clean := path.Clean(path.Join(base, target))
	if clean == "." || clean == "" {
		return "", false
	}
	if clean == ".." || strings.HasPrefix(clean, "../") || path.IsAbs(clean) {
		return "", false
	}
	if _, err := safeRel(clean); err != nil {
		return "", false
	}
	return clean, true
}

func splitSuffix(dest string) (string, string) {
	if index := strings.IndexAny(dest, "?#"); index >= 0 {
		return dest[:index], dest[index:]
	}
	return dest, ""
}

func externalURL(dest string) bool {
	lower := strings.ToLower(dest)
	for _, prefix := range []string{"http://", "https://", "//", "mailto:", "tel:"} {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return false
}

func unsafeURL(dest string) bool {
	lower := strings.ToLower(strings.TrimSpace(dest))
	for _, prefix := range []string{"javascript:", "vbscript:", "file:", "data:", "blob:"} {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return false
}

func escapePath(name string) string {
	parts := strings.Split(name, "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

func isReadableText(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".md", ".markdown", ".mdown", ".txt", ".rst", ".adoc", ".log",
		".json", ".yaml", ".yml", ".toml", ".csv", ".ini", ".conf",
		".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css",
		".py", ".rs", ".rb", ".sh", ".bash", ".zsh", ".sql", ".xml":
		return true
	}
	return false
}

func (e Entry) docInDir(dir string) string {
	if dir == "." || dir == "" {
		return e.Doc()
	}
	prefix := strings.TrimSuffix(dir, "/") + "/"
	for _, name := range []string{"index.md", "README.md", "readme.md"} {
		if e.Has(prefix + name) {
			return prefix + name
		}
	}
	for _, file := range e.Files {
		if strings.HasPrefix(file.Path, prefix) && isDocPath(file.Path) {
			return file.Path
		}
	}
	return ""
}
