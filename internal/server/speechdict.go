package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const maxDictionaryWords = 4

type speechDictionary struct {
	path string

	mu      sync.Mutex
	mod     time.Time
	size    int64
	entries map[string]string
	words   int
}

func newSpeechDictionary(path string) *speechDictionary {
	return &speechDictionary{path: path}
}

func speechDictionaryPath() string {
	if path := strings.TrimSpace(os.Getenv("NIT_GUI_TTS_DICT")); path != "" {
		return expandHome(path)
	}
	dir := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME"))
	if dir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			dir = filepath.Join(home, ".config")
		}
	}
	return filepath.Join(dir, "nit-gui", "speech.json")
}

func (d *speechDictionary) rewrite(text string) string {
	if d == nil || d.path == "" {
		return text
	}
	entries, words := d.snapshot()
	if len(entries) == 0 {
		return text
	}
	tokens := speechTokens(text)
	if len(tokens) == 0 {
		return text
	}
	var builder strings.Builder
	last := 0
	for index := 0; index < len(tokens); {
		matched := 0
		for size := min(words, len(tokens)-index); size >= 1; size-- {
			key := speechPhrase(tokens[index : index+size])
			replacement, ok := entries[key]
			if !ok {
				continue
			}
			builder.WriteString(text[last:tokens[index].start])
			builder.WriteString(replacement)
			last = tokens[index+size-1].end
			matched = size
			break
		}
		if matched == 0 {
			index++
			continue
		}
		index += matched
	}
	builder.WriteString(text[last:])
	return builder.String()
}

type speechWord struct {
	text  string
	start int
	end   int
}

func speechTokens(text string) []speechWord {
	tokens := make([]speechWord, 0, 16)
	for index := 0; index < len(text); {
		r, size := utf8.DecodeRuneInString(text[index:])
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			index += size
			continue
		}
		start := index
		for index < len(text) {
			r, size = utf8.DecodeRuneInString(text[index:])
			if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
				break
			}
			index += size
		}
		tokens = append(tokens, speechWord{text: text[start:index], start: start, end: index})
	}
	return tokens
}

func speechPhrase(tokens []speechWord) string {
	words := make([]string, len(tokens))
	for index, token := range tokens {
		words[index] = strings.ToLower(token.text)
	}
	return strings.Join(words, " ")
}

func (d *speechDictionary) snapshot() (map[string]string, int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	info, err := os.Stat(d.path)
	if err != nil {
		d.entries = nil
		d.words = 0
		d.mod = time.Time{}
		d.size = 0
		return nil, 0
	}
	if info.ModTime().Equal(d.mod) && info.Size() == d.size {
		return d.entries, d.words
	}
	d.mod = info.ModTime()
	d.size = info.Size()
	entries, words := readSpeechDictionary(d.path)
	d.entries = entries
	d.words = words
	return entries, words
}

func readSpeechDictionary(path string) (map[string]string, int) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, 0
	}
	var source map[string]string
	if json.Unmarshal(raw, &source) != nil {
		return nil, 0
	}
	entries := make(map[string]string, len(source))
	words := 0
	for phrase, replacement := range source {
		replacement = strings.TrimSpace(replacement)
		tokens := speechTokens(phrase)
		if replacement == "" || len(tokens) == 0 || len(tokens) > maxDictionaryWords {
			continue
		}
		entries[speechPhrase(tokens)] = replacement
		if len(tokens) > words {
			words = len(tokens)
		}
	}
	return entries, words
}
