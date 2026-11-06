package opencode

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"strings"
)

const redactedValue = "[redacted]"

type Redactor struct {
	needles []string
}

func (c *Client) Redactor() *Redactor {
	password := c.password()
	if password == "" {
		return &Redactor{}
	}
	basic := "opencode:" + password
	return &Redactor{needles: []string{
		base64.StdEncoding.EncodeToString([]byte(basic)),
		basic,
		password,
	}}
}

func (r *Redactor) String(value string) string {
	if r == nil {
		return value
	}
	for _, needle := range r.needles {
		value = strings.ReplaceAll(value, needle, redactedValue)
	}
	return value
}

func (r *Redactor) Bytes(body []byte) []byte {
	if r == nil || len(r.needles) == 0 || len(body) == 0 {
		return body
	}
	return []byte(r.String(string(body)))
}

func (r *Redactor) JSON(body []byte) []byte {
	if r == nil || len(r.needles) == 0 || len(body) == 0 {
		return body
	}
	if !r.present(body) {
		return body
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var value any
	if err := dec.Decode(&value); err != nil {
		return r.Bytes(body)
	}
	out, err := json.Marshal(r.value(value))
	if err != nil {
		return r.Bytes(body)
	}
	return out
}

func (r *Redactor) present(body []byte) bool {
	for _, needle := range r.needles {
		if bytes.Contains(body, []byte(needle)) {
			return true
		}
	}
	return false
}

func (r *Redactor) value(value any) any {
	switch v := value.(type) {
	case string:
		return r.String(v)
	case []any:
		for i, item := range v {
			v[i] = r.value(item)
		}
		return v
	case map[string]any:
		clean := make(map[string]any, len(v))
		for key, item := range v {
			clean[r.String(key)] = r.value(item)
		}
		return clean
	default:
		return value
	}
}
