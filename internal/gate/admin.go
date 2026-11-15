package gate

import (
	"net/http"
	"net/url"

	"nitgui/internal/gateid"
)

func (s *Server) adminPage(w http.ResponseWriter, r *http.Request) {
	data := s.newView(r, "админка")
	if !data.User.Has(gateid.AdminUsers) {
		s.forbidden(w, r, Route{Prefix: "/admin"})
		return
	}
	for _, user := range s.users.List() {
		switch user.Status {
		case StatusPending:
			data.Pending = append(data.Pending, user)
		case StatusInvited:
			data.Invited = append(data.Invited, user)
		default:
			data.Users = append(data.Users, user)
		}
	}
	switch r.URL.Query().Get("ok") {
	case "approved":
		data.Message = "приглашение готово: передай ссылку человеку"
	}
	data.DeviceGroups = deviceGroups(s.devices.List(), s.now())
	s.render(w, "admin", data)
}

func (s *Server) adminApprove(w http.ResponseWriter, r *http.Request) {
	if !identity(r).Has(gateid.AdminUsers) {
		s.forbidden(w, r, Route{Prefix: "/admin"})
		return
	}
	name := r.PostFormValue("name")
	if _, err := s.users.Approve(name); err != nil {
		http.Redirect(w, r, "/admin", http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, "/admin?ok=approved#"+url.QueryEscape(name), http.StatusSeeOther)
}

func (s *Server) adminReject(w http.ResponseWriter, r *http.Request) {
	if !identity(r).Has(gateid.AdminUsers) {
		s.forbidden(w, r, Route{Prefix: "/admin"})
		return
	}
	if err := s.users.Reject(r.PostFormValue("name")); err != nil {
		data := s.newView(r, "админка")
		data.Error = err.Error()
		s.renderStatus(w, "admin", data, http.StatusBadRequest)
		return
	}
	http.Redirect(w, r, "/admin", http.StatusSeeOther)
}

func (s *Server) adminDeviceRemove(w http.ResponseWriter, r *http.Request) {
	if !identity(r).Has(gateid.AdminUsers) {
		s.forbidden(w, r, Route{Prefix: "/admin"})
		return
	}
	device := r.PostFormValue("id")
	if err := s.devices.Remove(device); err != nil {
		data := s.newView(r, "админка")
		data.Error = "устройство не найдено"
		s.renderStatus(w, "admin", data, http.StatusBadRequest)
		return
	}
	http.Redirect(w, r, "/admin", http.StatusSeeOther)
}
