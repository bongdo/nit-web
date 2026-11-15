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
	snapshot := s.health.get(s.now())
	data.Health = snapshot.Server
	if !data.User.Anonymous() {
		data.HasHealth = snapshot.Server.ok
	}
	for i, route := range routes {
		entry := routeView{Prefix: route.Prefix, Note: route.Note, Key: i + 1}
		if !data.User.Anonymous() {
			entry.Preview = previewURL(route.Prefix)
		}
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
	if !data.User.Anonymous() {
		data.Drop = s.dropLinks()
	}
	s.render(w, "home", data)
}

func (s *Server) dropLinks() []dropView {
	if s.drops == nil {
		return nil
	}
	entries, err := s.drops.List()
	if err != nil {
		s.log.Warn("gate drop list", "error", err)
		return nil
	}
	links := make([]dropView, 0, 6)
	for _, entry := range entries {
		kind := ""
		switch entry.Kind {
		case "site":
			kind = "страница"
		case "service":
			kind = "сервис"
		default:
			continue
		}
		slug := entry.Slug
		if slug == "" {
			slug = entry.ID
		}
		name := entry.Name
		if name == "" {
			name = slug
		}
		links = append(links, dropView{Name: name, Href: "/share/" + slug + "/", Kind: kind, Site: entry.Kind == "site", Public: entry.Public})
		if len(links) == 6 {
			break
		}
	}
	return links
}
