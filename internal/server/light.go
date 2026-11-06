package server

import (
	"encoding/json"
	"unicode/utf8"
)

const (
	lightReasoningChars = 240
	lightToolInputBytes = 2048
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
	content, ok := message["content"]
	if !ok || len(content) == 0 || string(content) == "null" {
		return raw, nil
	}
	var parts []json.RawMessage
	if err := json.Unmarshal(content, &parts); err != nil {
		return nil, err
	}
	changed := false
	for index, part := range parts {
		trimmed, partChanged, err := lightenPart(part)
		if err != nil {
			return nil, err
		}
		if partChanged {
			parts[index] = trimmed
			changed = true
		}
	}
	if !changed {
		return raw, nil
	}
	encoded, err := json.Marshal(parts)
	if err != nil {
		return nil, err
	}
	message["content"] = encoded
	return json.Marshal(message)
}

func lightenPart(raw []byte) (json.RawMessage, bool, error) {
	var part map[string]json.RawMessage
	if err := json.Unmarshal(raw, &part); err != nil {
		return nil, false, err
	}
	var kind string
	if err := json.Unmarshal(part["type"], &kind); err != nil {
		return nil, false, err
	}
	switch kind {
	case "tool":
		var state map[string]json.RawMessage
		if err := json.Unmarshal(part["state"], &state); err != nil {
			return nil, false, err
		}
		changed := false
		if _, ok := state["content"]; ok {
			delete(state, "content")
			changed = true
		}
		if input, ok := state["input"]; ok && len(input) > lightToolInputBytes {
			preview := string(input)
			if len(preview) > lightToolInputBytes {
				preview = preview[:lightToolInputBytes]
			}
			encoded, err := json.Marshal(preview)
			if err != nil {
				return nil, false, err
			}
			state["input"] = encoded
			changed = true
		}
		if !changed {
			return raw, false, nil
		}
		encoded, err := json.Marshal(state)
		if err != nil {
			return nil, false, err
		}
		part["state"] = encoded
		part["light"] = json.RawMessage("true")
		return json.Marshal(part)
	case "reasoning":
		var text string
		if err := json.Unmarshal(part["text"], &text); err != nil {
			return nil, false, err
		}
		if utf8.RuneCountInString(text) <= lightReasoningChars {
			return raw, false, nil
		}
		encoded, err := json.Marshal(truncateRunes(text, lightReasoningChars))
		if err != nil {
			return nil, false, err
		}
		part["text"] = encoded
		part["light"] = json.RawMessage("true")
		return json.Marshal(part)
	}
	return raw, false, nil
}

func truncateRunes(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit])
}
