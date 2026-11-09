package server

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestLightenMessageKeepsEditedFiles(t *testing.T) {
	raw := []byte(`{
		"id":"m1","type":"assistant","time":{"created":1},
		"content":[
			{"type":"text","text":"done"},
			{"type":"reasoning","text":"think"},
			{"type":"tool","id":"t1","name":"edit","state":{"status":"completed","metadata":{"files":[
				{"file":"/src/a.ts","additions":2,"deletions":1,"patch":"@@ -1,2 +4,2 @@\n-x\n+y\n+z"},
				{"path":"/src/b.ts","additions":3}
			]}}},
			{"type":"tool","id":"t2","name":"edit","state":{"status":"completed","metadata":{"files":[{"file":"/src/a.ts","additions":5,"patch":"@@ -9,0 +8,1 @@\n+more"}]}}},
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
		{Path: "/src/a.ts", Additions: 7, Deletions: 1, Lines: []lineRange{{Start: 4, End: 5}, {Start: 8, End: 8}}},
		{Path: "/src/b.ts", Additions: 3},
		{Path: "/src/c.ts"},
	}
	if !reflect.DeepEqual(message.Edited, want) {
		t.Fatalf("edited=%+v, want %+v", message.Edited, want)
	}
}

func TestPatchAddedLines(t *testing.T) {
	patch := strings.Join([]string{
		"Index: /src/a.ts",
		"--- /src/a.ts",
		"+++ /src/a.ts",
		"@@ -1,3 +10,4 @@",
		" context",
		"+added 11",
		"+added 12",
		"-old",
		" context",
		"@@ -20,0 +30,1 @@",
		"+new",
	}, "\n")
	want := []lineRange{{Start: 11, End: 12}, {Start: 30, End: 30}}
	if got := patchAddedLines(patch); !reflect.DeepEqual(got, want) {
		t.Fatalf("ranges=%+v, want %+v", got, want)
	}
	if got, want := patchAddedLines("@@ -1,2 +8,0 @@\n-a\n-b"), []lineRange{{Start: 8, End: 8}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("deletion ranges=%+v, want %+v", got, want)
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
