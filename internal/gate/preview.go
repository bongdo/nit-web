package gate

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
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
	if token := nitGateToken(previewHash(), s.now().Add(previewTTL)); token != "" {
		http.SetCookie(w, &http.Cookie{
			Name:     "nit_gate",
			Value:    token,
			Path:     "/",
			MaxAge:   int(previewTTL.Seconds()),
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
		})
	}
	http.Redirect(w, r, route.Prefix+"/", http.StatusSeeOther)
}

func previewHash() string {
	for _, name := range []string{"NIT_GATE_PASSWORD_HASH", "NIT_GUI_PASSWORD_HASH"} {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

func nitGateToken(hash string, expires time.Time) string {
	if hash == "" {
		return ""
	}
	sum := sha256.Sum256([]byte("nit-gate-session-v1\x00" + hash))
	payload := "v1." + strconv.FormatInt(expires.Unix(), 10)
	mac := hmac.New(sha256.New, sum[:])
	mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *Server) previewImage(w http.ResponseWriter, r *http.Request) {
	if identity(r).Anonymous() {
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
