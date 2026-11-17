package gate

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"nitgui/internal/gateid"
)

const previewTTL = 2 * time.Minute

func DefaultPreviewDir() string {
	if path := strings.TrimSpace(os.Getenv("NIT_GATE_PREVIEWS")); path != "" {
		return path
	}
	return filepath.Join(filepath.Dir(DefaultUsersPath()), "previews")
}

func (s *Server) previewProxy(w http.ResponseWriter, r *http.Request) {
	if !isLoopback(r.RemoteAddr) {
		s.notFound(w, r)
		return
	}
	prefix := "/" + r.PathValue("prefix")
	route, ok := s.routes.Match(prefix)
	if !ok || route.Prefix != prefix {
		s.notFound(w, r)
		return
	}
	id := gateid.Identity{
		User: "preview",
		Role: gateid.RoleAdmin,
		Caps: gateid.Caps(gateid.RoleAdmin),
		Exp:  s.now().Add(previewTTL).Unix(),
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    gateid.Sign(s.secret, id),
		Path:     "/",
		MaxAge:   int(previewTTL.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	if token := appSessionToken(appPasswordHash(), s.now().Add(previewTTL)); token != "" {
		http.SetCookie(w, &http.Cookie{
			Name:     appSessionCookie,
			Value:    token,
			Path:     "/",
			MaxAge:   int(previewTTL.Seconds()),
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
		})
	}
	http.Redirect(w, r, strings.TrimSuffix(route.Upstream, "/")+route.Prefix+"/", http.StatusSeeOther)
}

func (s *Server) previewImage(w http.ResponseWriter, r *http.Request) {
	if !identity(r).Has(gateid.AdminHost) {
		http.NotFound(w, r)
		return
	}
	name := r.PathValue("name")
	if strings.ContainsAny(name, `/\`) || !strings.HasSuffix(name, ".png") {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=60")
	http.ServeFile(w, r, filepath.Join(DefaultPreviewDir(), name))
}

func previewURL(prefix string) string {
	name := strings.TrimPrefix(prefix, "/")
	if name == "" || strings.ContainsAny(name, `/\`) {
		return ""
	}
	info, err := os.Stat(filepath.Join(DefaultPreviewDir(), name+".png"))
	if err != nil || info.IsDir() {
		return ""
	}
	return "/previews/" + name + ".png"
}
