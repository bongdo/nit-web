package gate

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	qrcode "github.com/skip2/go-qrcode"
)

const (
	qrBindCookie = "qr_bind"
	qrTTL        = 2 * time.Minute
	qrSweep      = 10 * time.Minute
)

type qrView struct {
	Code  string
	Image string
	Link  string
	Agent string
	IP    string
	User  string
	Done  bool
}

type qrTicket struct {
	expires time.Time
	bind    string
	agent   string
	ip      string
	user    string
	done    bool
}

type qrStore struct {
	mu    sync.Mutex
	items map[string]*qrTicket
}

func newQRStore() *qrStore {
	return &qrStore{items: map[string]*qrTicket{}}
}

func (q *qrStore) create(bind, agent, ip string, now time.Time) (string, bool) {
	code, err := randomToken()
	if err != nil {
		return "", false
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	for key, ticket := range q.items {
		if now.Sub(ticket.expires) > qrSweep {
			delete(q.items, key)
		}
	}
	q.items[code] = &qrTicket{expires: now.Add(qrTTL), bind: bind, agent: agent, ip: ip}
	return code, true
}

func (q *qrStore) lookup(code string, now time.Time) (qrTicket, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	ticket, ok := q.items[code]
	if !ok || now.After(ticket.expires) {
		return qrTicket{}, false
	}
	return *ticket, true
}

func (q *qrStore) confirm(code, user string, now time.Time) (qrTicket, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	ticket, ok := q.items[code]
	if !ok || now.After(ticket.expires) || ticket.done {
		return qrTicket{}, false
	}
	ticket.done = true
	ticket.user = user
	return *ticket, true
}

func (q *qrStore) claim(code, bind string, now time.Time) (qrTicket, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	ticket, ok := q.items[code]
	if !ok || now.After(ticket.expires) || !ticket.done || ticket.bind != bind {
		return qrTicket{}, false
	}
	delete(q.items, code)
	return *ticket, true
}

func (s *Server) qrCard(w http.ResponseWriter, r *http.Request) (qrView, bool) {
	bind, err := randomToken()
	if err != nil {
		return qrView{}, false
	}
	code, ok := s.qr.create(bind, deviceName(r.UserAgent()), clientIP(r), s.now())
	if !ok {
		return qrView{}, false
	}
	link := s.origin(r) + "/qr/" + code
	image, err := qrImage(link)
	if err != nil {
		return qrView{}, false
	}
	http.SetCookie(w, &http.Cookie{
		Name:     qrBindCookie,
		Value:    bind,
		Path:     "/",
		MaxAge:   int(qrTTL.Seconds()),
		HttpOnly: true,
		Secure:   s.secure(r),
		SameSite: http.SameSiteLaxMode,
	})
	return qrView{Code: code, Image: image, Link: link}, true
}

func (s *Server) qrConfirmPage(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	ticket, ok := s.qr.lookup(code, s.now())
	if !ok {
		s.notFound(w, r)
		return
	}
	id := identity(r)
	if id.Anonymous() {
		http.Redirect(w, r, "/login?next="+url.QueryEscape("/qr/"+code), http.StatusSeeOther)
		return
	}
	data := s.newNarrow(r, "вход с телефона")
	data.QR = qrView{Code: code, Agent: ticket.agent, IP: ticket.ip, User: id.User}
	s.render(w, "qr", data)
}

func (s *Server) qrConfirm(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	id := identity(r)
	if id.Anonymous() {
		http.Redirect(w, r, "/login?next="+url.QueryEscape("/qr/"+code), http.StatusSeeOther)
		return
	}
	ticket, ok := s.qr.confirm(code, id.User, s.now())
	if !ok {
		s.notFound(w, r)
		return
	}
	s.audit.Add(AuditEvent{User: id.User, IP: clientIP(r), Agent: deviceName(r.UserAgent()), Result: "qr"})
	data := s.newNarrow(r, "вход с телефона")
	data.QR = qrView{Code: code, Agent: ticket.agent, IP: ticket.ip, User: id.User, Done: true}
	s.render(w, "qr", data)
}

func (s *Server) qrStatus(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")
	reply := func(state string) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]string{"state": state})
	}
	ticket, ok := s.qr.lookup(code, s.now())
	bind, err := r.Cookie(qrBindCookie)
	if !ok || err != nil || bind.Value == "" || bind.Value != ticket.bind {
		reply("expired")
		return
	}
	if !ticket.done {
		reply("pending")
		return
	}
	user, ok := s.users.Get(ticket.user)
	if !ok || user.Status != StatusActive {
		reply("expired")
		return
	}
	if _, ok := s.qr.claim(code, bind.Value, s.now()); !ok {
		reply("expired")
		return
	}
	temp := r.URL.Query().Get("temp") == "1"
	next := safeNext(r.URL.Query().Get("next"))
	s.startSession(w, r, user, temp)
	s.audit.Add(AuditEvent{User: user.Name, IP: clientIP(r), Agent: deviceName(r.UserAgent()), Result: "qr", Temp: temp})
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]string{"state": "ok", "next": next})
}

func qrImage(text string) (string, error) {
	png, err := qrcode.Encode(text, qrcode.Medium, 360)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), nil
}

func randomToken() (string, error) {
	buf := make([]byte, 18)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func (s *Server) origin(r *http.Request) string {
	scheme := "http"
	if s.secure(r) {
		scheme = "https"
	}
	return scheme + "://" + strings.TrimSpace(r.Host)
}
