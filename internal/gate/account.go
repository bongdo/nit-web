package gate

import (
	"net/http"
	"time"

	"nitgui/internal/gateid"
)

func (s *Server) accountPage(w http.ResponseWriter, r *http.Request) {
	if identity(r).Anonymous() {
		http.Redirect(w, r, "/login?next=%2Faccount", http.StatusSeeOther)
		return
	}
	s.render(w, "account", s.accountView(r))
}

func (s *Server) accountView(r *http.Request) view {
	data := s.newView(r, "аккаунт")
	data.Error = r.URL.Query().Get("err")
	data.Devices = deviceViews(s.devices.ListFor(data.User.User), data.User.Dev, s.now())
	if user, ok := s.users.Get(data.User.User); ok {
		data.TOTPOn = user.TOTP != ""
		data.RecoveryLeft = len(user.Recovery)
	}
	return data
}

func (s *Server) accountPassword(w http.ResponseWriter, r *http.Request) {
	id := identity(r)
	if id.Anonymous() {
		http.Redirect(w, r, "/login?next=%2Faccount", http.StatusSeeOther)
		return
	}
	data := s.accountView(r)
	password := r.PostFormValue("password")
	current := r.PostFormValue("current")
	if _, ok := s.users.Authenticate(id.User, current); !ok {
		data.Error = "текущий пароль неверный"
		s.renderStatus(w, "account", data, http.StatusUnauthorized)
		return
	}
	if err := s.users.SetPasswordHash(id.User, password); err != nil {
		data.Error = passwordError(err)
		s.renderStatus(w, "account", data, http.StatusBadRequest)
		return
	}
	data.Message = "пароль обновлён"
	s.render(w, "account", data)
}

func (s *Server) accountTOTPStart(w http.ResponseWriter, r *http.Request) {
	id := identity(r)
	if id.Anonymous() {
		http.Redirect(w, r, "/login?next=%2Faccount", http.StatusSeeOther)
		return
	}
	data := s.accountView(r)
	if user, ok := s.users.Get(id.User); ok && user.TOTP != "" {
		data.Error = "двухфакторная защита уже включена — сначала отключите"
		s.renderStatus(w, "account", data, http.StatusBadRequest)
		return
	}
	if _, ok := s.users.Authenticate(id.User, r.PostFormValue("current")); !ok {
		data.Error = "текущий пароль неверный"
		s.renderStatus(w, "account", data, http.StatusUnauthorized)
		return
	}
	secret, err := newTOTPSecret()
	if err != nil {
		data.Error = "не удалось создать секрет"
		s.renderStatus(w, "account", data, http.StatusInternalServerError)
		return
	}
	image, err := qrImage(otpauthURL(id.User, secret))
	if err != nil {
		data.Error = "не удалось нарисовать QR"
		s.renderStatus(w, "account", data, http.StatusInternalServerError)
		return
	}
	data.TOTPSecret = groupSecret(secret)
	data.TOTPQR = image
	data.TOTPPending = s.signPayload("totp", []string{id.User, secret}, 10*time.Minute, s.now())
	s.render(w, "account", data)
}

func (s *Server) accountTOTPEnable(w http.ResponseWriter, r *http.Request) {
	id := identity(r)
	if id.Anonymous() {
		http.Redirect(w, r, "/login?next=%2Faccount", http.StatusSeeOther)
		return
	}
	data := s.accountView(r)
	if user, ok := s.users.Get(id.User); ok && user.TOTP != "" {
		data.Error = "двухфакторная защита уже включена — сначала отключите"
		s.renderStatus(w, "account", data, http.StatusBadRequest)
		return
	}
	if _, ok := s.users.Authenticate(id.User, r.PostFormValue("current")); !ok {
		data.Error = "текущий пароль неверный"
		s.renderStatus(w, "account", data, http.StatusUnauthorized)
		return
	}
	pending := r.PostFormValue("pending")
	fields, ok := s.readPayload("totp", pending, s.now())
	if !ok || len(fields) != 2 || fields[0] != id.User {
		data.Error = "секрет устарел, начните заново"
		s.renderStatus(w, "account", data, http.StatusBadRequest)
		return
	}
	secret := fields[1]
	step, ok := totpMatch(secret, r.PostFormValue("code"), s.now(), 0)
	if !ok {
		image, err := qrImage(otpauthURL(id.User, secret))
		if err != nil {
			image = ""
		}
		data.TOTPSecret = groupSecret(secret)
		data.TOTPQR = image
		data.TOTPPending = pending
		data.Error = "код не подошёл"
		s.renderStatus(w, "account", data, http.StatusUnauthorized)
		return
	}
	plain, hashed, err := newRecoveryCodes(8)
	if err != nil {
		data.Error = "не удалось создать коды восстановления"
		s.renderStatus(w, "account", data, http.StatusInternalServerError)
		return
	}
	if err := s.users.SetTOTP(id.User, secret, hashed); err != nil {
		data.Error = err.Error()
		s.renderStatus(w, "account", data, http.StatusInternalServerError)
		return
	}
	if err := s.users.UseTOTPStep(id.User, step); err != nil {
		s.log.Warn("gate totp step", "error", err)
	}
	data = s.accountView(r)
	data.Message = "двухфакторная защита включена"
	data.Recovery = plain
	s.audit.Add(AuditEvent{User: id.User, IP: gateid.ClientIP(r), Agent: deviceName(r.UserAgent()), Result: "totp-on"})
	s.render(w, "account", data)
}

func (s *Server) accountTOTPDisable(w http.ResponseWriter, r *http.Request) {
	id := identity(r)
	if id.Anonymous() {
		http.Redirect(w, r, "/login?next=%2Faccount", http.StatusSeeOther)
		return
	}
	data := s.accountView(r)
	user, ok := s.users.Get(id.User)
	if !ok || user.TOTP == "" {
		data.Error = "двухфакторная защита не включена"
		s.renderStatus(w, "account", data, http.StatusBadRequest)
		return
	}
	if _, ok := s.users.Authenticate(id.User, r.PostFormValue("current")); !ok {
		data.Error = "текущий пароль неверный"
		s.renderStatus(w, "account", data, http.StatusUnauthorized)
		return
	}
	code := r.PostFormValue("code")
	if _, ok := totpMatch(user.TOTP, code, s.now(), 0); !ok {
		if used, err := s.users.ConsumeRecovery(id.User, code); err != nil || !used {
			data.Error = "код не подошёл"
			s.renderStatus(w, "account", data, http.StatusUnauthorized)
			return
		}
	}
	if err := s.users.ClearTOTP(id.User); err != nil {
		data.Error = err.Error()
		s.renderStatus(w, "account", data, http.StatusInternalServerError)
		return
	}
	data = s.accountView(r)
	data.Message = "двухфакторная защита отключена"
	s.audit.Add(AuditEvent{User: id.User, IP: gateid.ClientIP(r), Agent: deviceName(r.UserAgent()), Result: "totp-off"})
	s.render(w, "account", data)
}

func (s *Server) accountDeviceRemove(w http.ResponseWriter, r *http.Request) {
	id := identity(r)
	if id.Anonymous() {
		http.Redirect(w, r, "/login?next=%2Faccount", http.StatusSeeOther)
		return
	}
	device := r.PostFormValue("id")
	if !s.devices.Has(id.User, device) {
		data := s.accountView(r)
		data.Error = "устройство не найдено"
		s.renderStatus(w, "account", data, http.StatusForbidden)
		return
	}
	if err := s.devices.Remove(device); err != nil {
		s.log.Warn("gate device remove", "error", err)
	}
	http.Redirect(w, r, "/account", http.StatusSeeOther)
}
