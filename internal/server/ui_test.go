package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"nitgui/internal/uistate"
)

func uiTestServer(t *testing.T) *Server {
	t.Helper()
	store, err := uistate.Open(filepath.Join(t.TempDir(), "ui-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	return &Server{ui: store}
}

func jsonRequest(method, target, body string) *http.Request {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	return request
}

func TestUIStateHandlers(t *testing.T) {
	s := uiTestServer(t)

	hidden := httptest.NewRecorder()
	s.setHidden(hidden, jsonRequest(http.MethodPost, "/api/ui/hidden", `{"ids":["ses_a"],"hidden":true}`))
	if hidden.Code != http.StatusOK {
		t.Fatalf("hidden status = %d: %s", hidden.Code, hidden.Body)
	}

	status := httptest.NewRecorder()
	request := jsonRequest(http.MethodPost, "/api/ui/sessions/ses_a/status", `{"status":"done"}`)
	request.SetPathValue("id", "ses_a")
	s.setSessionStatus(status, request)
	if status.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", status.Code, status.Body)
	}

	list := httptest.NewRecorder()
	s.uiState(list, httptest.NewRequest(http.MethodGet, "/api/ui", nil))
	if list.Code != http.StatusOK {
		t.Fatalf("list status = %d", list.Code)
	}
	body := list.Body.String()
	if !strings.Contains(body, `"hidden":["ses_a"]`) || !strings.Contains(body, `"ses_a":"done"`) {
		t.Fatalf("ui state = %s", body)
	}

	remove := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodDelete, "/api/ui/sessions/ses_a", nil)
	request.SetPathValue("id", "ses_a")
	s.removeSessionState(remove, request)
	if remove.Code != http.StatusOK {
		t.Fatalf("remove status = %d", remove.Code)
	}
	state := s.ui.Snapshot()
	if len(state.Hidden) != 0 || len(state.Status) != 0 {
		t.Fatalf("state after remove = %+v", state)
	}
}

func TestUIStateRejectsInvalid(t *testing.T) {
	s := uiTestServer(t)
	rec := httptest.NewRecorder()
	request := jsonRequest(http.MethodPost, "/api/ui/sessions/ses_a/status", `{"status":"wat"}`)
	request.SetPathValue("id", "ses_a")
	s.setSessionStatus(rec, request)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid status code = %d", rec.Code)
	}
}
