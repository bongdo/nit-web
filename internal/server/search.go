package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"nitgui/internal/opencode"
)

const (
	maxContentMatches = 30
	contentSnippet    = 180
	contentIndexTTL   = 3 * time.Second
)

const contentRowsSQL = `
SELECT m.session_id AS id,
       COALESCE(s.directory, '') AS directory,
       COALESCE(s.parent_id, '') AS parent,
       s.time_archived IS NOT NULL AS archived,
       s.time_updated AS updated,
       m.time_created AS created,
       COALESCE(json_extract(m.data, '$.text'), '') AS text,
       COALESCE((SELECT group_concat(json_extract(c.value, '$.text'), ' ')
                 FROM json_each(m.data, '$.content') c
                 WHERE json_extract(c.value, '$.type') = 'text'
                   AND json_extract(c.value, '$.text') IS NOT NULL), '') AS parts
FROM session_message m
JOIN session_v2 s ON s.id = m.session_id
WHERE m.type IN ('user', 'assistant')
  AND json_valid(m.data)
  AND (json_extract(m.data, '$.text') IS NOT NULL
       OR EXISTS (SELECT 1 FROM json_each(m.data, '$.content') c
                  WHERE json_extract(c.value, '$.type') = 'text'
                    AND json_extract(c.value, '$.text') IS NOT NULL))`

const contentStampSQL = `
SELECT COALESCE(max(time_updated), 0) + (SELECT COALESCE(max(time_updated), 0) FROM session_v2) AS stamp
FROM session_message`

type textMessage struct {
	created int64
	text    string
	lower   string
}

type sessionText struct {
	directory string
	parentID  string
	archived  bool
	updated   int64
	messages  []textMessage
}

type contentIndex struct {
	mu       sync.Mutex
	stamp    int64
	rebuilt  time.Time
	sessions map[string]*sessionText
}

type contentMatch struct {
	ID      string
	Snippet string
}

func (s *Server) addContentMatches(ctx context.Context, c *opencode.Client, raw json.RawMessage, instance, query, dir string) json.RawMessage {
	hits := s.contentMatches(ctx, instance, query, dir)
	if len(hits) == 0 {
		return raw
	}
	var page map[string]json.RawMessage
	if err := json.Unmarshal(raw, &page); err != nil {
		return raw
	}
	var data []json.RawMessage
	if err := json.Unmarshal(page["data"], &data); err != nil {
		return raw
	}
	seen := make(map[string]int, len(data))
	for index, item := range data {
		var session struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(item, &session) == nil && session.ID != "" {
			seen[session.ID] = index
		}
	}
	added := 0
	for _, hit := range hits {
		if index, ok := seen[hit.ID]; ok {
			data[index] = withSnippet(data[index], hit.Snippet)
			continue
		}
		if added >= maxContentMatches {
			break
		}
		var fetched struct {
			Data map[string]any `json:"data"`
		}
		if err := c.Do(ctx, http.MethodGet, "/api/session/"+url.PathEscape(hit.ID), nil, &fetched); err != nil {
			continue
		}
		if fetched.Data == nil {
			continue
		}
		fetched.Data["snippet"] = hit.Snippet
		item, err := json.Marshal(fetched.Data)
		if err != nil {
			continue
		}
		data = append(data, item)
		seen[hit.ID] = len(data) - 1
		added++
	}
	encoded, err := json.Marshal(data)
	if err != nil {
		return raw
	}
	page["data"] = encoded
	out, err := json.Marshal(page)
	if err != nil {
		return raw
	}
	return out
}

func withSnippet(raw json.RawMessage, snippet string) json.RawMessage {
	var session map[string]any
	if err := json.Unmarshal(raw, &session); err != nil {
		return raw
	}
	session["snippet"] = snippet
	out, err := json.Marshal(session)
	if err != nil {
		return raw
	}
	return out
}

func (s *Server) contentMatches(ctx context.Context, instance, query, dir string) []contentMatch {
	db := s.localDatabase(instance)
	if db == "" || utf8.RuneCountInString(query) < 2 {
		return nil
	}
	idx := s.contentIndexFor(instance)
	if err := idx.refresh(ctx, db); err != nil {
		s.log.Debug("content search unavailable", "instance", instance, "error", err)
		return nil
	}
	return idx.find(query, dir)
}

func (s *Server) contentIndexFor(instance string) *contentIndex {
	s.searchMu.Lock()
	defer s.searchMu.Unlock()
	if s.searchIdx == nil {
		s.searchIdx = map[string]*contentIndex{}
	}
	idx := s.searchIdx[instance]
	if idx == nil {
		idx = &contentIndex{}
		s.searchIdx[instance] = idx
	}
	return idx
}

func (s *Server) localDatabase(instance string) string {
	for _, spec := range s.multi.Instances() {
		if spec.Name != instance || spec.SSH != "" {
			continue
		}
		if spec.URL != "" && spec.URL != "auto" && !opencode.IsLoopbackURL(spec.URL) {
			return ""
		}
		dir := opencodeDataDir()
		if dir == "" {
			return ""
		}
		path := filepath.Join(dir, "opencode.db")
		if _, err := os.Stat(path); err != nil {
			return ""
		}
		return path
	}
	return ""
}

func opencodeDataDir() string {
	if dir := os.Getenv("XDG_DATA_HOME"); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".local", "share")
}

func (i *contentIndex) refresh(ctx context.Context, db string) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	out, err := runSQLite(ctx, db, contentStampSQL)
	if err != nil {
		return err
	}
	var stamp struct {
		Stamp int64 `json:"stamp"`
	}
	if err := json.Unmarshal(out, &stamp); err != nil {
		return err
	}
	if i.sessions != nil && (stamp.Stamp == i.stamp || time.Since(i.rebuilt) < contentIndexTTL) {
		return nil
	}
	sessions, err := readSessionTexts(ctx, db)
	if err != nil {
		return err
	}
	i.sessions = sessions
	i.stamp = stamp.Stamp
	i.rebuilt = time.Now()
	return nil
}

func readSessionTexts(ctx context.Context, db string) (map[string]*sessionText, error) {
	out, err := runSQLite(ctx, db, contentRowsSQL)
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(out)) == 0 {
		return map[string]*sessionText{}, nil
	}
	var rows []struct {
		ID        string `json:"id"`
		Directory string `json:"directory"`
		Parent    string `json:"parent"`
		Archived  bool   `json:"archived"`
		Updated   int64  `json:"updated"`
		Created   int64  `json:"created"`
		Text      string `json:"text"`
		Parts     string `json:"parts"`
	}
	if err := json.Unmarshal(out, &rows); err != nil {
		return nil, err
	}
	sessions := make(map[string]*sessionText)
	for _, row := range rows {
		text := strings.TrimSpace(strings.Join([]string{row.Text, row.Parts}, "\n"))
		if text == "" {
			continue
		}
		entry := sessions[row.ID]
		if entry == nil {
			entry = &sessionText{
				directory: row.Directory,
				parentID:  row.Parent,
				archived:  row.Archived,
				updated:   row.Updated,
			}
			sessions[row.ID] = entry
		}
		entry.messages = append(entry.messages, textMessage{
			created: row.Created,
			text:    text,
			lower:   strings.ToLower(text),
		})
	}
	return sessions, nil
}

func (i *contentIndex) find(query, dir string) []contentMatch {
	needle := strings.ToLower(query)
	i.mu.Lock()
	defer i.mu.Unlock()
	var matches []contentMatch
	for id, session := range i.sessions {
		if session.archived || (dir != "" && session.directory != dir) {
			continue
		}
		if text, ok := session.snippet(needle); ok {
			matches = append(matches, contentMatch{ID: id, Snippet: text})
		}
	}
	sort.Slice(matches, func(a, b int) bool {
		return i.sessions[matches[a].ID].updated > i.sessions[matches[b].ID].updated
	})
	if len(matches) > maxContentMatches {
		matches = matches[:maxContentMatches]
	}
	return matches
}

func (s *sessionText) snippet(needle string) (string, bool) {
	var found *textMessage
	for i := range s.messages {
		message := &s.messages[i]
		if !strings.Contains(message.lower, needle) {
			continue
		}
		if found == nil || message.created > found.created {
			found = message
		}
	}
	if found == nil {
		return "", false
	}
	return snippetAround(found.text, found.lower, needle), true
}

func snippetAround(text, lower, needle string) string {
	at := strings.Index(lower, needle)
	if at < 0 {
		return ""
	}
	start := max(at-60, 0)
	end := min(at+len(needle)+80, len(text))
	for start > 0 && !utf8.RuneStart(text[start]) {
		start--
	}
	for end < len(text) && !utf8.RuneStart(text[end]) {
		end++
	}
	out := strings.Join(strings.Fields(text[start:end]), " ")
	if start > 0 {
		out = "…" + out
	}
	if end < len(text) {
		out += "…"
	}
	return out
}

func runSQLite(ctx context.Context, db, query string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sqlite3", "-readonly", "-json", db, query)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("sqlite3: %w %s", err, strings.TrimSpace(stderr.String()))
	}
	return out, nil
}
