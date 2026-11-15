package gate

import (
	"net/http"
	"net/url"
)

func (s *Server) home(w http.ResponseWriter, r *http.Request) {
	data := s.newView(r, "bongdo.space")
	data.Message = r.URL.Query().Get("ok")
	routes := s.routes.sorted()
	data.Services = plural(len(routes), "сервис", "сервиса", "сервисов")
	for i, route := range routes {
		entry := routeView{Prefix: route.Prefix, Note: route.Note, Key: i + 1}
		switch {
		case route.Optional || data.User.Has(route.Cap):
			entry.State = "open"
			entry.Href = route.Prefix + "/"
		case data.User.Anonymous():
			entry.State = "login"
			entry.Href = "/login?next=" + url.QueryEscape(route.Prefix+"/")
		default:
			entry.State = "denied"
		}
		data.Routes = append(data.Routes, entry)
	}
	s.render(w, "home", data)
}
