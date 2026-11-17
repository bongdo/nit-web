package gate

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"

	"nitgui/internal/gateid"
)

func (s *Server) loginPage(w http.ResponseWriter, r *http.Request) {
	data := s.newNarrow(r, "вход")
	data.Next = gateid.SafeNext(r.URL.Query().Get("next"))
	if card, ok := s.qrCard(w, r); ok {
		data.QR = card
	}
	s.render(w, "login", data)
}

func (s *Server) loginSubmit(w http.ResponseWriter, r *http.Request) {
	next := gateid.SafeNext(r.PostFormValue("next"))
	name := r.PostFormValue("name")
	code := strings.TrimSpace(r.PostFormValue("code"))
	password := r.PostFormValue("password")
	temp := r.PostFormValue("temp") != ""

	account, exists := s.users.Get(name)
	hasCode := exists && account.Status == StatusActive && account.TOTP != ""

	if hasCode && code != "" && password != "" {
		if wait, blocked := s.blockedKey("u:" + account.Name); blocked {
			s.loginError(w, r, next, name, "слишком много кодов, попробуйте через "+wait.Round(time.Second).String(), http.StatusTooManyRequests)
			return
		}
	}

	var user User
	ok := false
	switch {
	case hasCode:
		user = account
		ok = s.consumeCode(account, code)
		if !ok && password != "" {
			s.noteFailureKey("u:" + account.Name)
		}
	case password != "":
		user, ok = s.users.Authenticate(name, password)
	}

	if !ok {
		s.audit.Add(AuditEvent{User: strings.TrimSpace(name), IP: gateid.ClientIP(r), Agent: deviceName(r.UserAgent()), Result: "fail"})
		s.noteFailure(r)
		if wait, blocked := s.blockedIP(r); blocked {
			s.loginError(w, r, next, name, "слишком много попыток, верный код пустят сразу, иначе через "+wait.Round(time.Second).String(), http.StatusTooManyRequests)
			return
		}
		message := "неверное имя, код или пароль"
		switch {
		case hasCode && code == "":
			message = "введите код из приложения"
		case exists && !hasCode && code != "":
			message = "у этого аккаунта нет кода — войдите по паролю"
		}
		s.loginError(w, r, next, name, message, http.StatusUnauthorized)
		return
	}

	s.resetFailures(r)
	s.resetKey("u:" + user.Name)
	s.startSession(w, r, user, temp)
	s.audit.Add(AuditEvent{User: user.Name, IP: gateid.ClientIP(r), Agent: deviceName(r.UserAgent()), Result: "ok", Temp: temp})
	http.Redirect(w, r, next, http.StatusSeeOther)
}

func (s *Server) consumeCode(user User, code string) bool {
	if code == "" {
		return false
	}
	if step, ok := totpMatch(user.TOTP, code, s.now(), user.TOTPStep); ok {
		if err := s.users.UseTOTPStep(user.Name, step); err != nil {
			s.log.Warn("gate totp step", "error", err)
		}
		return true
	}
	used, err := s.users.ConsumeRecovery(user.Name, code)
	if err != nil {
		s.log.Warn("gate recovery code", "error", err)
	}
	return used
}

func (s *Server) loginError(w http.ResponseWriter, r *http.Request, next, name, message string, status int) {
	data := s.newNarrow(r, "вход")
	data.Error = message
	data.Next = next
	data.Name = name
	if card, ok := s.qrCard(w, r); ok {
		data.QR = card
	}
	s.renderStatus(w, "login", data, status)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	s.stopSession(w, r)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *Server) signPayload(kind string, fields []string, ttl time.Duration, now time.Time) string {
	payload := strings.Join(append([]string{kind}, fields...), "|") + "|" + strconv.FormatInt(now.Add(ttl).Unix(), 10)
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Server) readPayload(kind, token string, now time.Time) ([]string, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, false
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, false
	}
	mac := hmac.New(sha256.New, s.secret)
	mac.Write(raw)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return nil, false
	}
	fields := strings.Split(string(raw), "|")
	if len(fields) < 3 || fields[0] != kind {
		return nil, false
	}
	expires, err := strconv.ParseInt(fields[len(fields)-1], 10, 64)
	if err != nil || now.Unix() >= expires {
		return nil, false
	}
	return fields[1 : len(fields)-1], true
}
