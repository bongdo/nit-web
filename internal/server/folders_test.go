package server_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFoldersListsDirectories(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/fs/list" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("location[directory]"); got != "/home/ubuntu" {
			t.Errorf("location = %q", got)
		}
		fmt.Fprint(w, `{"location":{"directory":"/home/ubuntu"},"data":[
			{"path":"work/","type":"directory"},
			{"path":"projects/","type":"directory"},
			{"path":".config/","type":"directory"},
			{"path":"notes.md","type":"file"}]}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/fs?path=/home/ubuntu", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	var body struct {
		Path      string   `json:"path"`
		Parent    string   `json:"parent"`
		Dirs      []string `json:"dirs"`
		Truncated bool     `json:"truncated"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Path != "/home/ubuntu" || body.Parent != "/home" {
		t.Fatalf("path = %q parent = %q", body.Path, body.Parent)
	}
	want := []string{"projects", "work", ".config"}
	if len(body.Dirs) != len(want) {
		t.Fatalf("dirs = %v", body.Dirs)
	}
	for i := range want {
		if body.Dirs[i] != want[i] {
			t.Fatalf("dirs = %v, want %v", body.Dirs, want)
		}
	}
	if body.Truncated {
		t.Fatal("unexpected truncation")
	}
}

func TestFoldersDefaultPathComesFromLocation(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/location":
			fmt.Fprint(w, `{"directory":"/srv/projects"}`)
		case "/api/fs/list":
			if got := r.URL.Query().Get("location[directory]"); got != "/srv/projects" {
				t.Errorf("location = %q", got)
			}
			fmt.Fprint(w, `{"data":[{"path":"app/","type":"directory"}]}`)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/fs", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if got := rec.Body.String(); !strings.Contains(got, `"path":"/srv/projects"`) || !strings.Contains(got, `"app"`) {
		t.Fatalf("body = %s", got)
	}
}

func TestFoldersMissingAndRelative(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		fmt.Fprint(w, `{"_tag":"LocationNotFoundError","message":"Location not found: /nope"}`)
	}))
	defer upstream.Close()
	handler := newHandler(t, upstream.URL)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/fs?path=/nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing folder status = %d: %s", rec.Code, rec.Body)
	}

	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/fs?path=relative/dir", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("relative path status = %d: %s", rec.Code, rec.Body)
	}
}
