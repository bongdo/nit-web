package server

import (
	"html"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
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

	speechDate    = regexp.MustCompile(`\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b`)
	speechClock   = regexp.MustCompile(`\b([01]?\d|2[0-3]):([0-5]\d)\b`)
	speechPercent = regexp.MustCompile(`\b(\d+)\s*%`)
	speechDollar  = regexp.MustCompile(`\$\s*(\d+)`)
	speechEuro    = regexp.MustCompile(`€\s*(\d+)`)
	speechRuble   = regexp.MustCompile(`(\d+)\s*₽`)
	speechAbbrev  = regexp.MustCompile(`(?i)(т\.\s*е\.|т\.\s*к\.|т\.\s*д\.|т\.\s*п\.|напр\.|др\.|см\.)`)
	speechUnits   = regexp.MustCompile(`(?i)(\d+)\s*` + speechUnitPattern() + `([^\p{L}\p{N}]|$)`)
)

var speechMonths = [...]string{
	"", "января", "февраля", "марта", "апреля", "мая", "июня",
	"июля", "августа", "сентября", "октября", "ноября", "декабря",
}

var speechAbbreviations = map[string]string{
	"т.е.": "то есть", "т.к.": "так как", "т.д.": "так далее",
	"т.п.": "тому подобное", "напр.": "например", "др.": "другие",
	"см.": "смотри",
}

type speechUnit struct {
	forms []string
	one   string
	few   string
	many  string
}

var speechUnitList = []speechUnit{
	{[]string{"файлы", "файлов", "файла", "файл"}, "файл", "файла", "файлов"},
	{[]string{"строки", "строку", "строк", "строка"}, "строка", "строки", "строк"},
	{[]string{"коммиты", "коммитов", "коммита", "коммит"}, "коммит", "коммита", "коммитов"},
	{[]string{"тесты", "тестов", "теста", "тест"}, "тест", "теста", "тестов"},
	{[]string{"баги", "багов", "бага", "баг"}, "баг", "бага", "багов"},
	{[]string{"символы", "символов", "символа", "символ"}, "символ", "символа", "символов"},
	{[]string{"знаки", "знаков", "знака", "знак"}, "знак", "знака", "знаков"},
	{[]string{"токены", "токенов", "токена", "токен"}, "токен", "токена", "токенов"},
	{[]string{"минуты", "минуту", "минут", "минута"}, "минута", "минуты", "минут"},
	{[]string{"секунды", "секунду", "секунд", "секунда"}, "секунда", "секунды", "секунд"},
	{[]string{"часы", "часов", "часа", "час"}, "час", "часа", "часов"},
	{[]string{"дни", "дней", "дня", "день"}, "день", "дня", "дней"},
	{[]string{"недели", "недель", "неделю", "неделя"}, "неделя", "недели", "недель"},
	{[]string{"месяцы", "месяцев", "месяца", "месяц"}, "месяц", "месяца", "месяцев"},
	{[]string{"раза", "разы", "раз"}, "раз", "раза", "раз"},
	{[]string{"проценты", "процентов", "процента", "процент"}, "процент", "процента", "процентов"},
	{[]string{"терабайты", "терабайтов", "терабайта", "терабайт"}, "терабайт", "терабайта", "терабайтов"},
	{[]string{"гигабайты", "гигабайтов", "гигабайта", "гигабайт"}, "гигабайт", "гигабайта", "гигабайтов"},
	{[]string{"мегабайты", "мегабайтов", "мегабайта", "мегабайт"}, "мегабайт", "мегабайта", "мегабайтов"},
	{[]string{"килобайты", "килобайтов", "килобайта", "килобайт"}, "килобайт", "килобайта", "килобайтов"},
	{[]string{"байты", "байтов", "байта", "байт"}, "байт", "байта", "байтов"},
	{[]string{"страницы", "страницу", "страниц", "страница"}, "страница", "страницы", "страниц"},
	{[]string{"задачи", "задачу", "задач", "задача"}, "задача", "задачи", "задач"},
	{[]string{"ошибки", "ошибку", "ошибок", "ошибка"}, "ошибка", "ошибки", "ошибок"},
}

func speechUnitPattern() string {
	forms := make([]string, 0, len(speechUnitList)*4)
	for _, unit := range speechUnitList {
		forms = append(forms, unit.forms...)
	}
	sort.Slice(forms, func(i, j int) bool { return len(forms[i]) > len(forms[j]) })
	for index, form := range forms {
		forms[index] = regexp.QuoteMeta(form)
	}
	return "(" + strings.Join(forms, "|") + ")"
}

func speechUnitFor(form string) (speechUnit, bool) {
	form = strings.ToLower(form)
	for _, unit := range speechUnitList {
		for _, candidate := range unit.forms {
			if candidate == form {
				return unit, true
			}
		}
	}
	return speechUnit{}, false
}

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
	table := make([]string, 0, 16)
	language := ""
	inCode := false
	flushTable := func() {
		if len(table) == 0 {
			return
		}
		parts = append(parts, speechTable(table))
		table = table[:0]
	}
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !inCode && (strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~")) {
			flushTable()
			inCode = true
			language = strings.TrimSpace(strings.Trim(trimmed, "`~ "))
			code = code[:0]
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
			flushTable()
			continue
		}
		if strings.HasPrefix(trimmed, "|") {
			table = append(table, trimmed)
			continue
		}
		flushTable()
		if speechRule(trimmed) {
			continue
		}
		if line := speechLine(trimmed); line != "" {
			parts = append(parts, line)
		}
	}
	flushTable()
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
	line = speechAbbreviate(line)
	line = html.UnescapeString(line)
	line = strings.NewReplacer(
		"**", "", "__", "", "~~", "", "*", "", "`", "",
		"<", " ", ">", " ", "[", " ", "]", " ",
	).Replace(line)
	line = speechNumbers(line)
	line = speechSpace.ReplaceAllString(line, " ")
	line = strings.TrimSpace(line)
	if line == "" {
		return ""
	}
	return speechSentence(line)
}

func speechAbbreviate(text string) string {
	matches := speechAbbrev.FindAllStringSubmatchIndex(text, -1)
	if len(matches) == 0 {
		return text
	}
	var builder strings.Builder
	last := 0
	for _, match := range matches {
		start, end := match[0], match[1]
		if start > 0 && speechLetter(lastRune(text[:start])) || end < len(text) && speechLetter(firstRune(text[end:])) {
			continue
		}
		key := strings.ToLower(strings.Join(strings.Fields(text[start:end]), ""))
		value, ok := speechAbbreviations[key]
		if !ok {
			continue
		}
		if unicode.IsUpper(firstRune(text[start:])) {
			runes := []rune(value)
			runes[0] = unicode.ToUpper(runes[0])
			value = string(runes)
		}
		builder.WriteString(text[last:start])
		builder.WriteString(value)
		last = end
	}
	builder.WriteString(text[last:])
	return builder.String()
}

func speechLetter(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r)
}

func lastRune(text string) rune {
	r, _ := utf8.DecodeLastRuneInString(text)
	return r
}

func firstRune(text string) rune {
	r, _ := utf8.DecodeRuneInString(text)
	return r
}

func speechNumbers(text string) string {
	text = speechDate.ReplaceAllStringFunc(text, func(token string) string {
		match := speechDate.FindStringSubmatch(token)
		day, _ := strconv.Atoi(match[1])
		month, _ := strconv.Atoi(match[2])
		if day < 1 || day > 31 || month < 1 || month > 12 {
			return token
		}
		return match[1] + " " + speechMonths[month] + " " + match[3] + " года"
	})
	text = speechClock.ReplaceAllString(text, "$1 $2")
	text = speechPercent.ReplaceAllStringFunc(text, func(token string) string {
		match := speechPercent.FindStringSubmatch(token)
		return speechUnitCount(match[1], speechUnit{one: "процент", few: "процента", many: "процентов"})
	})
	text = speechDollar.ReplaceAllStringFunc(text, func(token string) string {
		return speechUnitCount(speechDollar.FindStringSubmatch(token)[1], speechUnit{one: "доллар", few: "доллара", many: "долларов"})
	})
	text = speechEuro.ReplaceAllStringFunc(text, func(token string) string {
		return speechEuro.FindStringSubmatch(token)[1] + " евро"
	})
	text = speechRuble.ReplaceAllStringFunc(text, func(token string) string {
		return speechUnitCount(speechRuble.FindStringSubmatch(token)[1], speechUnit{one: "рубль", few: "рубля", many: "рублей"})
	})
	text = speechUnits.ReplaceAllStringFunc(text, func(token string) string {
		match := speechUnits.FindStringSubmatch(token)
		unit, ok := speechUnitFor(match[2])
		if !ok || !strings.EqualFold(match[2], unit.one) {
			return token
		}
		count, err := strconv.Atoi(match[1])
		if err != nil || speechPlural(count, unit.one, unit.few, unit.many) == unit.one {
			return token
		}
		return match[1] + " " + speechPlural(count, unit.one, unit.few, unit.many) + match[3]
	})
	text = strings.ReplaceAll(text, "№", "номер ")
	text = strings.ReplaceAll(text, "±", "плюс минус ")
	return text
}

func speechUnitCount(numeric string, unit speechUnit) string {
	count, err := strconv.Atoi(numeric)
	if err != nil {
		return numeric + " " + unit.many
	}
	return strconv.Itoa(count) + " " + speechPlural(count, unit.one, unit.few, unit.many)
}

func speechTable(lines []string) string {
	columns := strings.Count(lines[0], "|") - 1
	if columns < 1 {
		return "Таблица."
	}
	rows := len(lines) - 1
	if len(lines) > 1 && speechTableSeparator(lines[1]) {
		rows -= 1
	}
	if rows < 0 {
		rows = 0
	}
	return "Таблица: " + speechCount(columns, "колонка", "колонки", "колонок") +
		", " + speechCount(rows, "строка", "строки", "строк") + "."
}

func speechTableSeparator(line string) bool {
	if !strings.Contains(line, "-") {
		return false
	}
	for _, char := range line {
		if char != '|' && char != '-' && char != ':' && char != ' ' && char != '\t' {
			return false
		}
	}
	return true
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
	return speechCount(lines, "строка", "строки", "строк")
}

func speechCount(n int, one, few, many string) string {
	return strconv.Itoa(n) + " " + speechPlural(n, one, few, many)
}

func speechPlural(n int, one, few, many string) string {
	mod100 := n % 100
	if mod100 >= 11 && mod100 <= 14 {
		return many
	}
	switch n % 10 {
	case 1:
		return one
	case 2, 3, 4:
		return few
	}
	return many
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
	if strings.HasPrefix(token, "-") && len(token) > 1 && !speechDigits(token[1:]) {
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
		return "версия " + strings.ReplaceAll(strings.TrimPrefix(text, "v"), ".", " точка ")
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

func speechDigits(text string) bool {
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
