package gate

import "net/http"

func (s *Server) home(w http.ResponseWriter, r *http.Request) {
	data := s.newView(r, "bongdo.space")
	data.Message = r.URL.Query().Get("ok")
	for _, route := range s.routes.sorted() {
		entry := routeView{Prefix: route.Prefix, Note: route.Note, Open: true}
		if !route.Optional && !data.User.Has(route.Cap) {
			entry.Open = false
			entry.Reason = "нужен вход"
			if !data.User.Anonymous() {
				entry.Reason = "нет прав"
			}
		}
		data.Routes = append(data.Routes, entry)
	}
	s.render(w, "home", data)
}
