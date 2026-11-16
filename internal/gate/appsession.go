package gate

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const appSessionCookie = "nit_gate"

func appPasswordHash() string {
	for _, name := range []string{"NIT_GATE_PASSWORD_HASH", "NIT_GUI_PASSWORD_HASH"} {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

func appSessionToken(hash string, expires time.Time) string {
	if hash == "" {
		return ""
	}
	sum := sha256.Sum256([]byte("nit-gate-session-v1\x00" + hash))
	payload := "v1." + strconv.FormatInt(expires.Unix(), 10)
	mac := hmac.New(sha256.New, sum[:])
	mac.Write([]byte(payload))
	return payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func appSessionValid(hash, token string, now time.Time) bool {
	if hash == "" || token == "" {
		return false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		return false
	}
	expires, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || now.Unix() >= expires {
		return false
	}
	sum := sha256.Sum256([]byte("nit-gate-session-v1\x00" + hash))
	mac := hmac.New(sha256.New, sum[:])
	mac.Write([]byte(parts[0] + "." + parts[1]))
	return hmac.Equal([]byte(parts[2]), []byte(base64.RawURLEncoding.EncodeToString(mac.Sum(nil))))
}

func (s *Server) ensureAppSession(w http.ResponseWriter, r *http.Request, persist bool) {
	hash := appPasswordHash()
	if hash == "" {
		return
	}
	if cookie, err := r.Cookie(appSessionCookie); err == nil && appSessionValid(hash, cookie.Value, s.now()) {
		return
	}
	cookie := &http.Cookie{
		Name:     appSessionCookie,
		Value:    appSessionToken(hash, s.now().Add(sessionTTL)),
		Path:     "/",
		HttpOnly: true,
		Secure:   s.secure(r),
		SameSite: http.SameSiteLaxMode,
	}
	if persist {
		cookie.MaxAge = int(sessionTTL.Seconds())
	}
	http.SetCookie(w, cookie)
}
