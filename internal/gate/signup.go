package gate

import (
	"net/http"
	"strings"
	"time"

	"nitgui/internal/gateid"
)

func (s *Server) signupPage(w http.ResponseWriter, r *http.Request) {
	s.render(w, "signup", s.newView(r, "запрос доступа"))
}

func (s *Server) signupSubmit(w http.ResponseWriter, r *http.Request) {
	key := "signup:" + gateid.ClientIP(r)
	if wait, blocked := s.blockedKey(key); blocked {
		data := s.newNarrow(r, "запрос доступа")
		data.Error = "слишком много заявок, попробуйте через " + wait.Round(time.Second).String()
		s.renderStatus(w, "signup", data, http.StatusTooManyRequests)
		return
	}
	s.noteFailureKey(key)
	name := strings.TrimSpace(r.PostFormValue("name"))
	_, err := s.users.Request(name)
	data := s.newNarrow(r, "запрос доступа")
	if err != nil {
		data.Error = signupError(err)
		data.Name = name
		s.renderStatus(w, "signup", data, http.StatusBadRequest)
		return
	}
	data.Message = "заявка отправлена: " + strings.ToLower(name)
	s.render(w, "signup", data)
}

func signupError(err error) string {
	switch err {
	case ErrUserExists:
		return "такое имя уже занято"
	case ErrBadName:
		return "имя: 2–32 символа, латиница, цифры, дефис или подчёркивание"
	default:
		return "не получилось: " + err.Error()
	}
}
