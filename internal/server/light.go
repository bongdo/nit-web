package server

import "encoding/json"

type lightToolState struct {
	Status string          `json:"status"`
	Error  json.RawMessage `json:"error,omitempty"`
}

type lightPart struct {
	Type     string          `json:"type"`
	ID       string          `json:"id,omitempty"`
	Name     string          `json:"name,omitempty"`
	Executed *bool           `json:"executed,omitempty"`
	Time     json.RawMessage `json:"time,omitempty"`
	Ordinal  *int            `json:"ordinal,omitempty"`
	Text     *string         `json:"text,omitempty"`
	State    *lightToolState `json:"state,omitempty"`
	Light    bool            `json:"light,omitempty"`
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
	var kind struct {
		Type string `json:"type"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(raw, &kind); err != nil {
		return nil, false, err
	}
	if kind.Type != "tool" && kind.Type != "reasoning" {
		return raw, false, nil
	}
	if kind.Name == "question" {
		return raw, false, nil
	}
	var part lightPart
	if err := json.Unmarshal(raw, &part); err != nil {
		return nil, false, err
	}
	part.Light = true
	if kind.Type == "reasoning" {
		empty := ""
		part.Text = &empty
	}
	encoded, err := json.Marshal(part)
	if err != nil {
		return nil, false, err
	}
	return encoded, true, nil
}
