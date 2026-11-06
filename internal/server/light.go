package server

import (
	"encoding/json"
	"strconv"
)

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
	return json.Marshal(message)
}
