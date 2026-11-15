package gate

import (
	"net/http"
	"net/url"
	"time"

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
	data.Error = r.URL.Query().Get("err")
	data.DeviceGroups = deviceGroups(s.devices.List(), data.User.Dev, s.now())
	for _, event := range s.audit.Last(40) {
		entry := auditView{
			When:   time.Unix(event.Time, 0).Format("02.01 15:04"),
			User:   event.User,
			IP:     event.IP,
			Agent:  event.Agent,
			Result: "вход",
		}
		switch event.Result {
		case "fail":
			entry.Result = "отказ"
			entry.Failed = true
		case "invite":
			entry.Result = "приглашение"
		}
		data.Log = append(data.Log, entry)
	}
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

func (s *Server) adminDeviceRename(w http.ResponseWriter, r *http.Request) {
	if !identity(r).Has(gateid.AdminUsers) {
		s.forbidden(w, r, Route{Prefix: "/admin"})
		return
	}
	s.renameDevice(w, r, "/admin")
}

func (s *Server) accountDeviceRename(w http.ResponseWriter, r *http.Request) {
	if identity(r).Anonymous() {
		http.Redirect(w, r, "/login?next=%2Faccount", http.StatusSeeOther)
		return
	}
	s.renameDevice(w, r, "/account")
}

func (s *Server) renameDevice(w http.ResponseWriter, r *http.Request, back string) {
	id := identity(r)
	device := r.PostFormValue("id")
	if !id.Has(gateid.AdminUsers) && !s.devices.Has(id.User, device) {
		s.forbidden(w, r, Route{Prefix: back})
		return
	}
	name, err := cleanDeviceName(r.PostFormValue("name"))
	if err != nil {
		http.Redirect(w, r, back+"?err="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	if err := s.devices.Rename(device, name); err != nil {
		http.Redirect(w, r, back+"?err="+url.QueryEscape("устройство не найдено"), http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, back, http.StatusSeeOther)
}
