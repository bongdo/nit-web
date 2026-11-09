package server

import (
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type lineRange struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

type editedFile struct {
	Path      string      `json:"path"`
	Additions int         `json:"additions,omitempty"`
	Deletions int         `json:"deletions,omitempty"`
	Lines     []lineRange `json:"lines,omitempty"`
}

var hunkPattern = regexp.MustCompile(`^@@ -[0-9]+(,[0-9]+)? \+([0-9]+)(,[0-9]+)? @@`)

func pushLineRange(ranges []lineRange, line int) []lineRange {
	if len(ranges) > 0 {
		last := &ranges[len(ranges)-1]
		if line <= last.End+1 {
			if line > last.End {
				last.End = line
			}
			return ranges
		}
	}
	return append(ranges, lineRange{Start: line, End: line})
}

func patchAddedLines(patch string) []lineRange {
	if strings.TrimSpace(patch) == "" {
		return nil
	}
	var ranges []lineRange
	line, firstHunk := 0, 0
	inHunk := false
	for _, row := range strings.Split(patch, "\n") {
		if match := hunkPattern.FindStringSubmatch(row); match != nil {
			line, _ = strconv.Atoi(match[2])
			if firstHunk == 0 {
				firstHunk = line
			}
			inHunk = true
			continue
		}
		if !inHunk {
			continue
		}
		switch {
		case strings.HasPrefix(row, "+"):
			ranges = pushLineRange(ranges, line)
			line++
		case strings.HasPrefix(row, " "):
			line++
		}
	}
	if len(ranges) == 0 && firstHunk > 0 {
		return []lineRange{{Start: firstHunk, End: firstHunk}}
	}
	return ranges
}

func mergeLineRanges(left, right []lineRange) []lineRange {
	if len(left)+len(right) == 0 {
		return nil
	}
	all := append(append([]lineRange{}, left...), right...)
	sort.Slice(all, func(i, j int) bool {
		if all[i].Start != all[j].Start {
			return all[i].Start < all[j].Start
		}
		return all[i].End < all[j].End
	})
	merged := make([]lineRange, 0, len(all))
	for _, item := range all {
		if len(merged) > 0 {
			last := &merged[len(merged)-1]
			if item.Start <= last.End+1 {
				if item.End > last.End {
					last.End = item.End
				}
				continue
			}
		}
		merged = append(merged, item)
	}
	return merged
}

var editedWriters = map[string]bool{
	"write":     true,
	"edit":      true,
	"multiedit": true,
	"patch":     true,
}

func fileEntries(raw json.RawMessage) []editedFile {
	var metadata struct {
		Files []struct {
			File      string `json:"file"`
			Path      string `json:"path"`
			Additions int    `json:"additions"`
			Deletions int    `json:"deletions"`
			Patch     string `json:"patch"`
		} `json:"files"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &metadata) != nil {
		return nil
	}
	files := make([]editedFile, 0, len(metadata.Files))
	for _, item := range metadata.Files {
		path := item.File
		if path == "" {
			path = item.Path
		}
		if path == "" {
			continue
		}
		files = append(files, editedFile{
			Path:      path,
			Additions: item.Additions,
			Deletions: item.Deletions,
			Lines:     patchAddedLines(item.Patch),
		})
	}
	return files
}

func editedFromPart(part json.RawMessage) []editedFile {
	var tool struct {
		Name  string `json:"name"`
		State struct {
			Input    json.RawMessage `json:"input"`
			Metadata json.RawMessage `json:"metadata"`
		} `json:"state"`
	}
	if json.Unmarshal(part, &tool) != nil {
		return nil
	}
	if files := fileEntries(tool.State.Metadata); len(files) > 0 {
		return files
	}
	if !editedWriters[tool.Name] {
		return nil
	}
	var input map[string]any
	if json.Unmarshal(tool.State.Input, &input) != nil {
		return nil
	}
	for _, key := range []string{"path", "filePath", "file_path"} {
		if path, ok := input[key].(string); ok && path != "" {
			return []editedFile{{Path: path}}
		}
	}
	return nil
}

func addEdited(target *[]editedFile, index map[string]int, files []editedFile) {
	for _, file := range files {
		if at, ok := index[file.Path]; ok {
			(*target)[at].Additions += file.Additions
			(*target)[at].Deletions += file.Deletions
			(*target)[at].Lines = mergeLineRanges((*target)[at].Lines, file.Lines)
			continue
		}
		index[file.Path] = len(*target)
		*target = append(*target, file)
	}
}

func lightenTranscript(data []byte) ([]byte, error) {
	var messages []json.RawMessage
	if err := json.Unmarshal(data, &messages); err != nil {
		return nil, err
	}
	light := make([]json.RawMessage, len(messages))
	for index, message := range messages {
		trimmed, err := lightenMessage(message)
		if err != nil {
			return nil, err
		}
		light[index] = trimmed
	}
	return json.Marshal(light)
}

func lightenMessage(raw []byte) (json.RawMessage, error) {
	var message map[string]json.RawMessage
	if err := json.Unmarshal(raw, &message); err != nil {
		return nil, err
	}
	var kind struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &kind); err != nil {
		return nil, err
	}
	if kind.Type != "assistant" {
		return raw, nil
	}
	content, ok := message["content"]
	if !ok || len(content) == 0 || string(content) == "null" {
		return raw, nil
	}
	var parts []json.RawMessage
	if err := json.Unmarshal(content, &parts); err != nil {
		return nil, err
	}
	kept := make([]json.RawMessage, 0, len(parts))
	steps, tools, errors := 0, 0, 0
	edited := make([]editedFile, 0)
	editedIndex := map[string]int{}
	for _, part := range parts {
		var partKind struct {
			Type  string `json:"type"`
			Name  string `json:"name"`
			State struct {
				Status string `json:"status"`
			} `json:"state"`
		}
		if err := json.Unmarshal(part, &partKind); err != nil {
			return nil, err
		}
		if partKind.Type == "reasoning" {
			steps++
			continue
		}
		if partKind.Type == "tool" && partKind.Name != "question" {
			steps++
			tools++
			if partKind.State.Status == "error" {
				errors++
			}
			addEdited(&edited, editedIndex, editedFromPart(part))
			continue
		}
		kept = append(kept, part)
	}
	if steps == 0 {
		return raw, nil
	}
	encoded, err := json.Marshal(kept)
	if err != nil {
		return nil, err
	}
	message["content"] = encoded
	message["steps"] = json.RawMessage(strconv.Itoa(steps))
	if tools > 0 {
		message["tools"] = json.RawMessage(strconv.Itoa(tools))
	} else {
		delete(message, "tools")
	}
	if errors > 0 {
		message["errors"] = json.RawMessage(strconv.Itoa(errors))
	} else {
		delete(message, "errors")
	}
	if len(edited) > 0 {
		encoded, err := json.Marshal(edited)
		if err != nil {
			return nil, err
		}
		message["edited"] = encoded
	} else {
		delete(message, "edited")
	}
	return json.Marshal(message)
}
