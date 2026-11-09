package server

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestLightenMessageKeepsEditedFiles(t *testing.T) {
	raw := []byte(`{
		"id":"m1","type":"assistant","time":{"created":1},
		"content":[
			{"type":"text","text":"done"},
			{"type":"reasoning","text":"think"},
			{"type":"tool","id":"t1","name":"edit","state":{"status":"completed","metadata":{"files":[
				{"file":"/src/a.ts","additions":2,"deletions":1},
				{"path":"/src/b.ts","additions":3}
			]}}},
			{"type":"tool","id":"t2","name":"edit","state":{"status":"completed","metadata":{"files":[{"file":"/src/a.ts","additions":5}]}}},
			{"type":"tool","id":"t3","name":"write","state":{"status":"completed","input":{"filePath":"/src/c.ts"}}}
		]
	}`)
	out, err := lightenMessage(raw)
	if err != nil {
		t.Fatal(err)
	}
	var message struct {
		Content []json.RawMessage `json:"content"`
		Steps   int               `json:"steps"`
		Tools   int               `json:"tools"`
		Edited  []editedFile      `json:"edited"`
	}
	if err := json.Unmarshal(out, &message); err != nil {
		t.Fatal(err)
	}
	if message.Steps != 4 || message.Tools != 3 {
		t.Fatalf("steps=%d tools=%d, want 4/3", message.Steps, message.Tools)
	}
	if len(message.Content) != 1 {
		t.Fatalf("kept %d parts, want 1", len(message.Content))
	}
	want := []editedFile{
		{Path: "/src/a.ts", Additions: 7, Deletions: 1},
		{Path: "/src/b.ts", Additions: 3},
		{Path: "/src/c.ts"},
	}
	if !reflect.DeepEqual(message.Edited, want) {
		t.Fatalf("edited=%+v, want %+v", message.Edited, want)
	}
}

func TestLightenMessageOmitsEditedWithoutWrites(t *testing.T) {
	raw := []byte(`{
		"id":"m1","type":"assistant","time":{"created":1},
		"content":[
			{"type":"text","text":"done"},
			{"type":"tool","id":"t1","name":"read","state":{"status":"completed","input":{"filePath":"/src/a.ts"}}}
		]
	}`)
	out, err := lightenMessage(raw)
	if err != nil {
		t.Fatal(err)
	}
	var message map[string]json.RawMessage
	if err := json.Unmarshal(out, &message); err != nil {
		t.Fatal(err)
	}
	if _, ok := message["edited"]; ok {
		t.Fatalf("edited present without writes: %s", out)
	}
}
