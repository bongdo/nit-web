package gate

import "net/http"

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
