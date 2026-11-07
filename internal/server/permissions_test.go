package server_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestPermissionsProxy(t *testing.T) {
	var method, path string
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		method, path = r.Method, r.URL.Path
		fmt.Fprintf(w, `{"data":[{"id":"per_1","sessionID":"ses_1","permission":"bash","patterns":["secret %s"]}]}`, testPassword)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions/ses_1/permissions", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if method != http.MethodGet || path != "/api/session/ses_1/permission" {
		t.Fatalf("upstream request = %s %s", method, path)
	}
	assertNoSecret(t, rec.Body.String(), "permissions")
	if !strings.Contains(rec.Body.String(), "[redacted]") {
		t.Fatalf("permissions were not redacted: %s", rec.Body)
	}
	if !strings.Contains(rec.Body.String(), `"id":"per_1"`) {
		t.Fatalf("unexpected body: %s", rec.Body)
	}
}

func TestPermissionReply(t *testing.T) {
	var method, path string
	var body struct {
		Decision string `json:"decision"`
		Message  string `json:"message"`
	}
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		method, path = r.Method, r.URL.Path
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost,
		"http://127.0.0.1:7788/api/sessions/ses_1/permissions/per_1/reply",
		strings.NewReader(`{"decision":"always","message":"allow this tool"}`))
	req.Header.Set("Content-Type", "application/json")
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if method != http.MethodPost || path != "/api/session/ses_1/permission/per_1/reply" {
		t.Fatalf("upstream request = %s %s", method, path)
	}
	if body.Decision != "always" || body.Message != "allow this tool" {
		t.Fatalf("upstream body = %+v", body)
	}
	if !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("unexpected body: %s", rec.Body)
	}
}

func TestPermissionReplyRejectsBadDecision(t *testing.T) {
	var called atomic.Bool
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		called.Store(true)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost,
		"http://127.0.0.1:7788/api/sessions/ses_1/permissions/per_1/reply",
		strings.NewReader(`{"decision":"maybe"}`))
	req.Header.Set("Content-Type", "application/json")
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if called.Load() {
		t.Fatal("invalid decision reached upstream")
	}
}

func TestSessionsForwardsCursor(t *testing.T) {
	upstream := httptest.NewServer(auth(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("cursor") != "abc" {
			t.Errorf("cursor = %q", q.Get("cursor"))
		}
		if q.Get("limit") != "100" || q.Get("order") != "desc" || q.Get("archived") != "false" {
			t.Errorf("query = %s", r.URL.RawQuery)
		}
		if q.Get("parentID") != "null" {
			t.Errorf("parentID = %q", q.Get("parentID"))
		}
		fmt.Fprint(w, `{"data":[],"cursor":{"next":"def"}}`)
	}))
	defer upstream.Close()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:7788/api/sessions?cursor=abc&dir=/home/ubuntu", nil)
	newHandler(t, upstream.URL).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), `"next":"def"`) {
		t.Fatalf("cursor was not passed through: %s", rec.Body)
	}
}
