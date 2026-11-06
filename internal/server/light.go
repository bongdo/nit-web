package server

import "encoding/json"

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
		for _, key := range []string{"content", "input", "metadata"} {
			if _, ok := state[key]; ok {
				delete(state, key)
				changed = true
			}
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
		encodedPart, err := json.Marshal(part)
		if err != nil {
			return nil, false, err
		}
		return encodedPart, true, nil
	case "reasoning":
		var text string
		if err := json.Unmarshal(part["text"], &text); err != nil {
			return nil, false, err
		}
		if text == "" {
			return raw, false, nil
		}
		part["text"] = json.RawMessage(`""`)
		part["light"] = json.RawMessage("true")
		encodedPart, err := json.Marshal(part)
		if err != nil {
			return nil, false, err
		}
		return encodedPart, true, nil
	}
	return raw, false, nil
}
