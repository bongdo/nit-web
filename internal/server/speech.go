package server

import (
	"html"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

var (
	speechImage   = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)`)
	speechLink    = regexp.MustCompile(`\[([^\]]+)\]\([^)]*\)`)
	speechCode    = regexp.MustCompile("`([^`]+)`")
	speechURL     = regexp.MustCompile(`https?://[^\s)>\]}]+`)
	speechEmail   = regexp.MustCompile(`\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b`)
	speechPath    = regexp.MustCompile(`(?:~|\.{1,2})?(?:/[\w.@+-]+)+/?|[\w.@+-]+(?:/[\w.@+-]+)+`)
	speechTag     = regexp.MustCompile(`</?[A-Za-z][^>]*>`)
	speechHeading = regexp.MustCompile(`^#{1,6}\s+(.*)$`)
	speechBullet  = regexp.MustCompile(`^(?:[-*+]|\d+[.)])\s+`)
	speechTask    = regexp.MustCompile(`^\[[ xX]\]\s*`)
	speechItalic  = regexp.MustCompile(`\b_([^_\n]+)_\b`)
	speechEmoji   = regexp.MustCompile(`[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{FE0F}\x{200D}]`)
	speechCamel1  = regexp.MustCompile(`([a-z0-9])([A-Z])`)
	speechCamel2  = regexp.MustCompile(`([A-Z]+)([A-Z][a-z])`)
	speechHex     = regexp.MustCompile(`^[0-9a-fA-F]{16,}$`)
	speechVersion = regexp.MustCompile(`^v?\d+(?:\.\d+)+$`)
	speechSpace   = regexp.MustCompile(`[ \t]+`)
	speechGap     = regexp.MustCompile(`\s{2,}`)
)

var speechLanguages = map[string]string{
	"go": "Go", "golang": "Go",
	"ts": "TypeScript", "typescript": "TypeScript", "tsx": "TypeScript",
	"js": "JavaScript", "javascript": "JavaScript", "jsx": "JavaScript",
	"py": "Python", "python": "Python",
	"sh": "shell", "bash": "shell", "shell": "shell", "zsh": "shell",
	"json": "JSON", "yaml": "YAML", "yml": "YAML", "toml": "TOML",
	"sql": "SQL", "html": "HTML", "css": "CSS", "scss": "CSS",
	"md": "Markdown", "markdown": "Markdown",
	"java": "Java", "kt": "Kotlin", "kotlin": "Kotlin",
	"rs": "Rust", "rust": "Rust",
	"c": "C", "h": "C", "cpp": "C++", "c++": "C++", "cs": "C#", "csharp": "C#",
	"php": "PHP", "rb": "Ruby", "ruby": "Ruby", "swift": "Swift", "dart": "Dart",
	"xml": "XML", "dockerfile": "Dockerfile", "nix": "Nix",
}

func speechText(markdown string) string {
	lines := strings.Split(strings.ReplaceAll(markdown, "\r\n", "\n"), "\n")
	parts := make([]string, 0, len(lines))
	code := make([]string, 0, 16)
	language := ""
	inCode := false
	inTable := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !inCode && (strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~")) {
			inCode = true
			language = strings.TrimSpace(strings.Trim(trimmed, "`~ "))
			code = code[:0]
			inTable = false
			continue
		}
		if inCode {
			if strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~") {
				inCode = false
				parts = append(parts, speechCodeSummary(language, len(code)))
				continue
			}
			if trimmed != "" {
				code = append(code, trimmed)
			}
			continue
		}
		if trimmed == "" {
			inTable = false
			continue
		}
		if strings.HasPrefix(trimmed, "|") {
			if !inTable {
				parts = append(parts, "Таблица.")
			}
			inTable = true
			continue
		}
		inTable = false
		if speechRule(trimmed) {
			continue
		}
		if line := speechLine(trimmed); line != "" {
			parts = append(parts, line)
		}
	}
	if inCode {
		parts = append(parts, speechCodeSummary(language, len(code)))
	}
	text := speechGap.ReplaceAllString(strings.Join(parts, " "), " ")
	text = strings.TrimSpace(text)
	return speechPunctuation(text)
}

func speechRule(line string) bool {
	line = strings.TrimSpace(line)
	if len(line) < 3 {
		return false
	}
	for _, char := range line {
		if char != '-' && char != '*' && char != '_' && char != '=' {
			return false
		}
	}
	return true
}

func speechLine(line string) string {
	line = strings.TrimSpace(line)
	line = strings.TrimSpace(strings.TrimLeft(line, ">"))
	if match := speechHeading.FindStringSubmatch(line); match != nil {
		line = match[1]
	}
	line = speechBullet.ReplaceAllString(line, "")
	line = speechTask.ReplaceAllString(line, "")
	line = speechImage.ReplaceAllString(line, "")
	line = speechLink.ReplaceAllString(line, "$1")
	line = speechCode.ReplaceAllStringFunc(line, func(token string) string {
		return " " + speechToken(token[1:len(token)-1]) + " "
	})
	line = speechURL.ReplaceAllStringFunc(line, func(raw string) string {
		return " ссылка на " + speechHost(raw)
	})
	line = speechEmail.ReplaceAllStringFunc(line, func(raw string) string {
		at := strings.LastIndex(raw, "@")
		return " почта " + speechWords(raw[:at]) + " собака " + speechWords(raw[at+1:])
	})
	line = speechPath.ReplaceAllStringFunc(line, speechToken)
	line = speechItalic.ReplaceAllString(line, "$1")
	line = speechTag.ReplaceAllString(line, " ")
	line = speechEmoji.ReplaceAllString(line, " ")
	line = html.UnescapeString(line)
	line = strings.NewReplacer(
		"**", "", "__", "", "~~", "", "*", "", "`", "",
		"<", " ", ">", " ", "[", " ", "]", " ",
	).Replace(line)
	line = speechSpace.ReplaceAllString(line, " ")
	line = strings.TrimSpace(line)
	if line == "" {
		return ""
	}
	return speechSentence(line)
}

func speechSentence(text string) string {
	text = strings.TrimRight(text, " \t,;:")
	if text == "" {
		return ""
	}
	last := text[len(text)-1]
	if strings.ContainsRune(".!?…", rune(last)) {
		return text
	}
	return text + "."
}

func speechPunctuation(text string) string {
	if text == "" {
		return ""
	}
	replacer := strings.NewReplacer(
		" .", ".", " ,", ",", " ;", ";", " :", ":", " !", "!", " ?", "?",
		"..", ".", "  ", " ",
	)
	text = replacer.Replace(text)
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	return speechSentence(text)
}

func speechCodeSummary(language string, lines int) string {
	if lines <= 0 {
		return "Блок кода."
	}
	name := speechLanguage(language)
	if name == "" {
		return "Блок кода, " + speechLines(lines) + "."
	}
	return "Блок кода на " + name + ", " + speechLines(lines) + "."
}

func speechLanguage(info string) string {
	fields := strings.FieldsFunc(strings.ToLower(info), func(char rune) bool {
		return char == ' ' || char == ',' || char == '{' || char == ':'
	})
	if len(fields) == 0 {
		return ""
	}
	if name, ok := speechLanguages[fields[0]]; ok {
		return name
	}
	raw := fields[0]
	for _, char := range raw {
		if !(char >= 'a' && char <= 'z') && !(char >= '0' && char <= '9') && char != '+' && char != '#' && char != '.' {
			return ""
		}
	}
	if len(raw) > 12 {
		return ""
	}
	return raw
}

func speechLines(lines int) string {
	word := "строк"
	mod100 := lines % 100
	mod10 := lines % 10
	if mod100 < 11 || mod100 > 14 {
		switch mod10 {
		case 1:
			word = "строка"
		case 2, 3, 4:
			word = "строки"
		}
	}
	return strconv.Itoa(lines) + " " + word
}

func speechToken(raw string) string {
	token := strings.TrimSpace(raw)
	token = strings.Trim(token, "`'\"()[]{}<>,;:!?")
	token = strings.TrimRight(token, ".")
	if token == "" {
		return ""
	}
	if strings.HasPrefix(token, "--") {
		return "флаг " + speechWords(token[2:])
	}
	if strings.HasPrefix(token, "-") && len(token) > 1 && !speechNumber(token[1:]) {
		return "флаг " + speechWords(token[1:])
	}
	if speechHex.MatchString(token) {
		return "хеш"
	}
	if strings.Contains(token, "@") && strings.Contains(token, ".") {
		at := strings.LastIndex(token, "@")
		return "почта " + speechWords(token[:at]) + " собака " + speechWords(token[at+1:])
	}
	if strings.Contains(token, "/") {
		return speechPathToken(token)
	}
	return speechWords(token)
}

func speechPathToken(token string) string {
	token = strings.Trim(token, "`'\"()[]{}<>,;:!?")
	token = strings.TrimRight(token, ".")
	segments := make([]string, 0, 8)
	for _, part := range strings.Split(token, "/") {
		part = strings.TrimSpace(part)
		if part == "" || part == "." || part == ".." || part == "~" {
			continue
		}
		segments = append(segments, part)
	}
	if len(segments) == 0 {
		return "путь"
	}
	last := segments[len(segments)-1]
	dot := strings.LastIndex(last, ".")
	if dot > 0 && dot < len(last)-1 {
		extension := last[dot+1:]
		if speechExtension(extension) {
			name := speechWords(last[:dot]) + " точка " + strings.ToLower(extension)
			if len(segments) > 1 {
				return "файл " + name + " в папке " + speechWords(strings.Join(segments[:len(segments)-1], " "))
			}
			return "файл " + name
		}
	}
	return speechWords(strings.Join(segments, " "))
}

func speechExtension(extension string) bool {
	if len(extension) > 8 {
		return false
	}
	for _, char := range extension {
		if !(char >= 'a' && char <= 'z') && !(char >= 'A' && char <= 'Z') && !(char >= '0' && char <= '9') {
			return false
		}
	}
	return true
}

func speechWords(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return ""
	}
	if speechVersion.MatchString(text) {
		return text
	}
	text = strings.ReplaceAll(text, "_", " ")
	text = strings.ReplaceAll(text, "-", " ")
	text = strings.ReplaceAll(text, ".", " ")
	text = speechCamel1.ReplaceAllString(text, "$1 $2")
	text = speechCamel2.ReplaceAllString(text, "$1 $2")
	var builder strings.Builder
	for _, char := range text {
		switch {
		case char >= 'a' && char <= 'z', char >= 'A' && char <= 'Z', char >= '0' && char <= '9',
			char >= 'а' && char <= 'я', char >= 'А' && char <= 'Я', char == 'ё', char == 'Ё':
			builder.WriteRune(char)
		default:
			builder.WriteByte(' ')
		}
	}
	return strings.TrimSpace(speechSpace.ReplaceAllString(builder.String(), " "))
}

func speechNumber(text string) bool {
	if text == "" {
		return false
	}
	for _, char := range text {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func speechHost(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		trimmed := strings.TrimPrefix(strings.TrimPrefix(raw, "https://"), "http://")
		if slash := strings.IndexByte(trimmed, '/'); slash >= 0 {
			trimmed = trimmed[:slash]
		}
		return trimmed
	}
	return strings.TrimPrefix(parsed.Host, "www.")
}
