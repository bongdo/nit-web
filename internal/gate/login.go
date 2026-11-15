package gate

import (
	"net/http"
	"strings"
	"time"
)

func (s *Server) loginPage(w http.ResponseWriter, r *http.Request) {
	data := s.newNarrow(r, "вход")
	data.Next = safeNext(r.URL.Query().Get("next"))
	s.render(w, "login", data)
}

func (s *Server) loginSubmit(w http.ResponseWriter, r *http.Request) {
	name := r.PostFormValue("name")
	password := r.PostFormValue("password")
	next := safeNext(r.PostFormValue("next"))
	user, ok := s.users.Authenticate(name, password)
	if ok {
		s.resetFailures(r)
		s.startSession(w, r, user)
		s.audit.Add(AuditEvent{User: user.Name, IP: clientIP(r), Agent: deviceName(r.UserAgent()), Result: "ok"})
		http.Redirect(w, r, next, http.StatusSeeOther)
		return
	}
	s.audit.Add(AuditEvent{User: strings.TrimSpace(name), IP: clientIP(r), Agent: deviceName(r.UserAgent()), Result: "fail"})
	s.noteFailure(r)
	if wait, blocked := s.blockedIP(r); blocked {
		data := s.newNarrow(r, "вход")
		data.Error = "слишком много попыток, верный пароль пустят сразу, иначе через " + wait.Round(time.Second).String()
		data.Next = next
		data.Name = name
		s.renderStatus(w, "login", data, http.StatusTooManyRequests)
		return
	}
	data := s.newNarrow(r, "вход")
	data.Error = "неверное имя или пароль"
	data.Next = next
	data.Name = name
	s.renderStatus(w, "login", data, http.StatusUnauthorized)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	s.stopSession(w, r)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}
