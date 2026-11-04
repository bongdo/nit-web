package opencode

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestRedactorJSONKeepsEscapedValuesValid(t *testing.T) {
	password := `p"a\ss-w0rd`
	basic := "opencode:" + password
	encoded := base64.StdEncoding.EncodeToString([]byte(basic))
	client := New(Endpoint{URL: "http://127.0.0.1", Password: password})

	raw := []byte(`{"text":"p\"a\\ss-w0rd opencode:p\"a\\ss-w0rd ` + encoded + `","count":3,"ok":true}`)
	out := client.Redactor().JSON(raw)

	var body struct {
		Text  string `json:"text"`
		Count int    `json:"count"`
		OK    bool   `json:"ok"`
	}
	if err := json.Unmarshal(out, &body); err != nil {
		t.Fatalf("redacted JSON does not parse: %v: %s", err, out)
	}
	if strings.Contains(body.Text, password) || strings.Contains(body.Text, encoded) {
		t.Fatalf("secret survived redaction: %q", body.Text)
	}
	if body.Text != "[redacted] [redacted] [redacted]" {
		t.Fatalf("unexpected redacted text: %q", body.Text)
	}
	if body.Count != 3 || !body.OK {
		t.Fatalf("non-string values changed: %s", out)
	}
}
