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
	store, err := uistate.Open(filepath.Join(t.TempDir(), "ui-state.json"), "local")
	if err != nil {
		t.Fatal(err)
	}
	return &Server{ui: store, multi: singleProvider{}}
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

	draft := httptest.NewRecorder()
	s.setDraft(draft, jsonRequest(http.MethodPost, "/api/ui/drafts", `{"key":"new:/tmp","text":"hello"}`))
	if draft.Code != http.StatusOK {
		t.Fatalf("draft status = %d: %s", draft.Code, draft.Body)
	}
	got := httptest.NewRecorder()
	s.getDraft(got, httptest.NewRequest(http.MethodGet, "/api/ui/drafts?key=new%3A%2Ftmp", nil))
	if got.Code != http.StatusOK || !strings.Contains(got.Body.String(), `"text":"hello"`) {
		t.Fatalf("draft = %d: %s", got.Code, got.Body)
	}

	model := httptest.NewRecorder()
	s.setModel(model, jsonRequest(http.MethodPost, "/api/ui/model", `{"model":{"id":"m","providerID":"p","variant":"v"}}`))
	if model.Code != http.StatusOK {
		t.Fatalf("model status = %d: %s", model.Code, model.Body)
	}
	agent := httptest.NewRecorder()
	s.setAgent(agent, jsonRequest(http.MethodPost, "/api/ui/agent", `{"agent":"build"}`))
	if agent.Code != http.StatusOK {
		t.Fatalf("agent status = %d: %s", agent.Code, agent.Body)
	}
	list = httptest.NewRecorder()
	s.uiState(list, httptest.NewRequest(http.MethodGet, "/api/ui", nil))
	if !strings.Contains(list.Body.String(), `"agent":"build"`) || !strings.Contains(list.Body.String(), `"providerID":"p"`) {
		t.Fatalf("ui state with preferences = %s", list.Body)
	}

	remove := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodDelete, "/api/ui/sessions/ses_a", nil)
	request.SetPathValue("id", "ses_a")
	s.removeSessionState(remove, request)
	if remove.Code != http.StatusOK {
		t.Fatalf("remove status = %d", remove.Code)
	}
	state := s.ui.Snapshot("local")
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

func TestUIStateIsIsolatedPerInstance(t *testing.T) {
	s := uiTestServer(t)

	hide := func(instance string) {
		request := jsonRequest(http.MethodPost, "/api/ui/hidden", `{"ids":["ses_a"],"hidden":true}`)
		request.Header.Set("X-Nit-Instance", instance)
		rec := httptest.NewRecorder()
		s.setHidden(rec, request)
		if rec.Code != http.StatusOK {
			t.Fatalf("hidden %s = %d: %s", instance, rec.Code, rec.Body)
		}
	}
	list := func(instance string) string {
		request := httptest.NewRequest(http.MethodGet, "/api/ui", nil)
		request.Header.Set("X-Nit-Instance", instance)
		rec := httptest.NewRecorder()
		s.uiState(rec, request)
		return rec.Body.String()
	}

	hide("alpha")
	if body := list("beta"); strings.Contains(body, `"ses_a"`) {
		t.Fatalf("beta leaked alpha state: %s", body)
	}
	if body := list("alpha"); !strings.Contains(body, `"hidden":["ses_a"]`) {
		t.Fatalf("alpha lost its state: %s", body)
	}
}
