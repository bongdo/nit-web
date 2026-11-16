package gate

import (
	"net/http"
	"net/url"
)

func (s *Server) invitePage(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	user, ok := s.users.ByToken(token)
	if !ok {
		s.renderStatus(w, "invite", s.newView(r, "приглашение"), http.StatusNotFound)
		return
	}
	data := s.newNarrow(r, "приглашение")
	data.Name = user.Name
	data.Token = token
	s.render(w, "invite", data)
}

func (s *Server) inviteSubmit(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if r.PostFormValue("password") != r.PostFormValue("confirm") {
		data := s.newNarrow(r, "приглашение")
		data.Token = token
		data.Error = "пароли не совпадают"
		s.renderStatus(w, "invite", data, http.StatusBadRequest)
		return
	}
	user, err := s.users.SetPassword(token, r.PostFormValue("password"))
	if err != nil {
		data := s.newNarrow(r, "приглашение")
		data.Token = token
		data.Error = passwordError(err)
		if err == ErrNotInvited {
			data.Error = "приглашение уже использовано или не существует"
		}
		s.renderStatus(w, "invite", data, http.StatusBadRequest)
		return
	}
	s.startSession(w, r, user, false)
	s.audit.Add(AuditEvent{User: user.Name, IP: clientIP(r), Agent: deviceName(r.UserAgent()), Result: "invite"})
	http.Redirect(w, r, "/?ok="+url.QueryEscape("добро пожаловать, "+user.Name), http.StatusSeeOther)
}
