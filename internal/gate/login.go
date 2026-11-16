package gate

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const pendingTTL = 5 * time.Minute

func (s *Server) loginPage(w http.ResponseWriter, r *http.Request) {
	data := s.newNarrow(r, "вход")
	data.Next = safeNext(r.URL.Query().Get("next"))
	if card, ok := s.qrCard(w, r); ok {
		data.QR = card
	}
	s.render(w, "login", data)
}

func (s *Server) loginSubmit(w http.ResponseWriter, r *http.Request) {
	next := safeNext(r.PostFormValue("next"))
	if pending := r.PostFormValue("pending"); pending != "" {
		s.loginSecondFactor(w, r, pending, next)
		return
	}
	name := r.PostFormValue("name")
	password := r.PostFormValue("password")
	temp := r.PostFormValue("temp") != ""
	user, ok := s.users.Authenticate(name, password)
	if !ok {
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
		return
	}
	if user.TOTP != "" {
		data := s.newNarrow(r, "вход")
		data.Step = "totp"
		data.Name = user.Name
		data.Next = next
		data.Temp = temp
		data.Pending = s.signPayload("login", []string{user.Name, strconv.FormatBool(temp)}, pendingTTL, s.now())
		s.render(w, "login", data)
		return
	}
	s.resetFailures(r)
	s.startSession(w, r, user, temp)
	s.audit.Add(AuditEvent{User: user.Name, IP: clientIP(r), Agent: deviceName(r.UserAgent()), Result: "ok", Temp: temp})
	http.Redirect(w, r, next, http.StatusSeeOther)
}

func (s *Server) loginSecondFactor(w http.ResponseWriter, r *http.Request, pending, next string) {
	if wait, blocked := s.blockedIP(r); blocked {
		data := s.newNarrow(r, "вход")
		data.Error = "слишком много попыток, попробуйте через " + wait.Round(time.Second).String()
		data.Next = next
		s.renderStatus(w, "login", data, http.StatusTooManyRequests)
		return
	}
	fields, ok := s.readPayload("login", pending, s.now())
	if !ok || len(fields) != 2 {
		http.Redirect(w, r, "/login?next="+url.QueryEscape(next), http.StatusSeeOther)
		return
	}
	name := fields[0]
	temp := fields[1] == "true"
	user, ok := s.users.Get(name)
	if !ok || user.Status != StatusActive || user.TOTP == "" {
		http.Redirect(w, r, "/login?next="+url.QueryEscape(next), http.StatusSeeOther)
		return
	}
	code := strings.TrimSpace(r.PostFormValue("code"))
	matched := false
	if step, ok := totpMatch(user.TOTP, code, s.now(), user.TOTPStep); ok {
		matched = true
		if err := s.users.UseTOTPStep(user.Name, step); err != nil {
			s.log.Warn("gate totp step", "error", err)
		}
	} else if used, err := s.users.ConsumeRecovery(user.Name, code); err == nil && used {
		matched = true
	}
	if !matched {
		s.audit.Add(AuditEvent{User: user.Name, IP: clientIP(r), Agent: deviceName(r.UserAgent()), Result: "fail"})
		s.noteFailure(r)
		data := s.newNarrow(r, "вход")
		data.Step = "totp"
		data.Name = user.Name
		data.Next = next
		data.Temp = temp
		data.Pending = pending
		data.Error = "код не подошёл"
		s.renderStatus(w, "login", data, http.StatusUnauthorized)
		return
	}
	s.resetFailures(r)
	s.startSession(w, r, user, temp)
	s.audit.Add(AuditEvent{User: user.Name, IP: clientIP(r), Agent: deviceName(r.UserAgent()), Result: "ok", Temp: temp})
	http.Redirect(w, r, next, http.StatusSeeOther)
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
