package server

import (
	"encoding/json"
	"net/http"
	"net/url"
)

func (s *Server) permissions(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	var raw json.RawMessage
	path := "/api/session/" + url.PathEscape(id) + "/permission"
	if err := c.Do(r.Context(), http.MethodGet, path, nil, &raw); err != nil {
		s.upstreamError(w, r, err)
		return
	}
	writeRaw(w, raw, c.Redactor())
}

func (s *Server) replyPermission(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	requestID := r.PathValue("requestID")
	if !validID(id) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	if requestID == "" || !validLabel(requestID, 200) {
		writeError(w, http.StatusBadRequest, "invalid permission request id")
		return
	}
	in, err := decodeJSON[struct {
		Decision string `json:"decision"`
		Message  string `json:"message"`
	}](w, r)
	if err != nil {
		writeDecodeError(w, err)
		return
	}
	switch in.Decision {
	case "once", "always", "reject":
	default:
		writeError(w, http.StatusBadRequest, "invalid decision")
		return
	}
	body := map[string]any{"decision": in.Decision}
	if in.Message != "" {
		body["message"] = in.Message
	}
	c, ok := s.withClient(w, r)
	if !ok {
		return
	}
	path := "/api/session/" + url.PathEscape(id) + "/permission/" + url.PathEscape(requestID) + "/reply"
	if err := c.Do(r.Context(), http.MethodPost, path, body, nil); err != nil {
		s.upstreamError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
