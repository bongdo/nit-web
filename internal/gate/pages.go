package gate

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"nitgui/internal/gateid"
)

type routeView struct {
	Prefix string
	Note   string
	Open   bool
	Reason string
}

type view struct {
	Title   string
	Narrow  bool
	User    gateid.Identity
	Routes  []routeView
	Users   []User
	Pending []User
	Invited []User
	Message string
	Error   string
	Next    string
	Name    string
	Token   string
}

func (s *Server) newView(r *http.Request, title string) view {
	return view{Title: title, User: identity(r)}
}

func (s *Server) newNarrow(r *http.Request, title string) view {
	data := s.newView(r, title)
	data.Narrow = true
	return data
}

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

func (s *Server) loginPage(w http.ResponseWriter, r *http.Request) {
	data := s.newNarrow(r, "вход")
	data.Next = safeNext(r.URL.Query().Get("next"))
	s.render(w, "login", data)
}

func (s *Server) loginSubmit(w http.ResponseWriter, r *http.Request) {
	if wait, blocked := s.blockedIP(r); blocked {
		data := s.newNarrow(r, "вход")
		data.Error = "слишком много попыток, попробуй через " + wait.Round(time.Minute).String()
		s.renderStatus(w, "login", data, http.StatusTooManyRequests)
		return
	}
	name := r.PostFormValue("name")
	password := r.PostFormValue("password")
	next := safeNext(r.PostFormValue("next"))
	user, ok := s.users.Authenticate(name, password)
	if !ok {
		s.noteFailure(r)
		data := s.newNarrow(r, "вход")
		data.Error = "неверное имя или пароль"
		data.Next = next
		data.Name = name
		s.renderStatus(w, "login", data, http.StatusUnauthorized)
		return
	}
	s.resetFailures(r)
	s.startSession(w, r, user)
	http.Redirect(w, r, next, http.StatusSeeOther)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	s.stopSession(w, r)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *Server) signupPage(w http.ResponseWriter, r *http.Request) {
	s.render(w, "signup", s.newView(r, "запрос доступа"))
}

func (s *Server) signupSubmit(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimSpace(r.PostFormValue("name"))
	_, err := s.users.Request(name)
	data := s.newNarrow(r, "запрос доступа")
	if err != nil {
		data.Error = signupError(err)
		data.Name = name
		s.renderStatus(w, "signup", data, http.StatusBadRequest)
		return
	}
	data.Message = "заявка отправлена: " + strings.ToLower(name)
	s.render(w, "signup", data)
}

func signupError(err error) string {
	switch err {
	case ErrUserExists:
		return "такое имя уже занято"
	case ErrBadName:
		return "имя: 2–32 символа, латиница, цифры, дефис или подчёркивание"
	default:
		return "не получилось: " + err.Error()
	}
}

func (s *Server) accountPage(w http.ResponseWriter, r *http.Request) {
	data := s.newNarrow(r, "аккаунт")
	if data.User.Anonymous() {
		http.Redirect(w, r, "/login?next=%2Faccount", http.StatusSeeOther)
		return
	}
	s.render(w, "account", data)
}

func (s *Server) accountPassword(w http.ResponseWriter, r *http.Request) {
	id := identity(r)
	if id.Anonymous() {
		http.Redirect(w, r, "/login?next=%2Faccount", http.StatusSeeOther)
		return
	}
	data := s.newNarrow(r, "аккаунт")
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

func passwordError(err error) string {
	if err == ErrBadPassword {
		return "пароль: минимум 8 символов"
	}
	return err.Error()
}

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

func (s *Server) invitePage(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	user, ok := s.users.ByToken(token)
	if !ok {
		s.renderStatus(w, "invite", s.newView(r, "приглашение"), http.StatusNotFound)
		return
	}
	data := s.newNarrow(r, "приглашение")
	data.Name = user.Name
	data.Token = token
	s.render(w, "invite", data)
}

func (s *Server) inviteSubmit(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if r.PostFormValue("password") != r.PostFormValue("confirm") {
		data := s.newNarrow(r, "приглашение")
		data.Token = token
		data.Error = "пароли не совпадают"
		s.renderStatus(w, "invite", data, http.StatusBadRequest)
		return
	}
	user, err := s.users.SetPassword(token, r.PostFormValue("password"))
	if err != nil {
		data := s.newNarrow(r, "приглашение")
		data.Token = token
		data.Error = passwordError(err)
		if err == ErrNotInvited {
			data.Error = "приглашение уже использовано или не существует"
		}
		s.renderStatus(w, "invite", data, http.StatusBadRequest)
		return
	}
	s.startSession(w, r, user)
	http.Redirect(w, r, "/?ok="+url.QueryEscape("добро пожаловать, "+user.Name), http.StatusSeeOther)
}

func (s *Server) notFound(w http.ResponseWriter, r *http.Request) {
	s.renderStatus(w, "empty", s.newView(r, "404"), http.StatusNotFound)
}

func (s *Server) forbidden(w http.ResponseWriter, r *http.Request, route Route) {
	data := s.newView(r, "нет доступа")
	data.Message = route.Prefix
	data.Error = "маршрут закрыт: нужна другая роль"
	s.renderStatus(w, "empty", data, http.StatusForbidden)
}

func (s *Server) render(w http.ResponseWriter, name string, data view) {
	s.renderStatus(w, name, data, http.StatusOK)
}

func (s *Server) renderStatus(w http.ResponseWriter, name string, data view, status int) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := pages.ExecuteTemplate(w, name, data); err != nil {
		s.log.Error("gate page failed", "page", name, "error", err)
	}
}

const pageSource = `
{{define "head"}}<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}}</title>
<style>
  :root { color-scheme: dark; --bg:#0e1013; --panel:#15181c; --line:#272b30; --text:#e8e6e3; --muted:#94908a; --accent:#c4794f; --ok:#6f9c7f; --bad:#b26a63; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.6 ui-sans-serif,system-ui,sans-serif; }
  .wrap { max-width:720px; margin:0 auto; padding:32px 20px 64px; }
  .wrap.narrow { max-width:380px; padding-top:8vh; }
  .wrap.narrow .stack { max-width:none; }
  .wrap.narrow header { margin-bottom:28px; }
  .wrap.narrow header .who { flex-wrap:wrap; justify-content:flex-end; }
  header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:24px; }
  header a.brand { color:var(--text); text-decoration:none; font-weight:600; letter-spacing:-.01em; }
  header .who { color:var(--muted); font-size:13px; display:flex; align-items:center; gap:10px; }
  header .who form { margin:0; }
  h1 { font-size:22px; margin:0 0 18px; letter-spacing:-.02em; }
  a { color:var(--accent); }
  .cards { display:grid; gap:10px; }
  .card { border:1px solid var(--line); border-radius:12px; padding:14px 16px; background:var(--panel); display:flex; justify-content:space-between; gap:12px; align-items:baseline; }
  .card .path { font-family:ui-monospace,monospace; font-size:13.5px; }
  .card .note { color:var(--muted); font-size:12.5px; }
  .card.locked .path { color:var(--muted); }
  .card.locked .note { color:var(--bad); }
  form.stack { display:grid; gap:12px; max-width:340px; }
  label { display:grid; gap:6px; font-size:13px; color:var(--muted); }
  input { background:#0f1215; border:1px solid var(--line); border-radius:9px; padding:10px 12px; color:var(--text); font:inherit; }
  button { background:var(--accent); border:0; border-radius:9px; padding:10px 14px; color:#16120f; font:600 14px/1 inherit; cursor:pointer; }
  button.ghost { background:transparent; border:1px solid var(--line); color:var(--text); }
  button.bad { background:transparent; border:1px solid #5a3a36; color:var(--bad); }
  .msg { border:1px solid #2f4a3a; background:#131a16; color:#9ec7ae; border-radius:10px; padding:10px 12px; margin-bottom:16px; font-size:14px; }
  .err { border:1px solid #4a2f2c; background:#1a1312; color:#d59a92; border-radius:10px; padding:10px 12px; margin-bottom:16px; font-size:14px; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font:600 11px/1.4 ui-monospace,monospace; letter-spacing:.08em; text-transform:uppercase; }
  .row-actions { display:flex; gap:8px; }
  .muted { color:var(--muted); }
  .mono { font-family:ui-monospace,monospace; font-size:12.5px; word-break:break-all; }
  section + section { margin-top:28px; }
  h2 { font:600 11px/1 ui-monospace,monospace; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); margin:0 0 12px; }
</style>
</head>
<body>
<div class="wrap{{if .Narrow}} narrow{{end}}">
<header>
  <a class="brand" href="/">bongdo.space</a>
  <div class="who">
    {{if .User.User}}<span>{{.User.User}} · {{.User.Role}}</span><a href="/account">аккаунт</a>{{if .User.Has "admin.users"}}<a href="/admin">админка</a>{{end}}<form method="post" action="/logout"><button class="ghost">выйти</button></form>{{else}}<a href="/login">войти</a><a href="/signup">запросить доступ</a>{{end}}
  </div>
</header>
{{if .Message}}<div class="msg">{{.Message}}</div>{{end}}
{{if .Error}}<div class="err">{{.Error}}</div>{{end}}
{{end}}

{{define "foot"}}
</div>
</body>
</html>
{{end}}

{{define "home"}}{{template "head" .}}
<h1>сервисы</h1>
<div class="cards">
  {{range .Routes}}
  <div class="card{{if not .Open}} locked{{end}}">
    <div>
      <div class="path">{{if .Open}}<a href="{{.Prefix}}/">{{.Prefix}}</a>{{else}}{{.Prefix}}{{end}}</div>
      <div class="note">{{if .Open}}{{.Note}}{{else}}{{.Reason}}{{end}}</div>
    </div>
  </div>
  {{end}}
</div>
{{template "foot" .}}{{end}}

{{define "login"}}{{template "head" .}}
<h1>вход</h1>
<form class="stack" method="post" action="/login">
  <input type="hidden" name="next" value="{{.Next}}">
  <label>имя<input name="name" value="{{.Name}}" autocomplete="username" autofocus></label>
  <label>пароль<input name="password" type="password" autocomplete="current-password"></label>
  <button>войти</button>
</form>
<p class="muted">Нет аккаунта? <a href="/signup">запросить доступ</a></p>
{{template "foot" .}}{{end}}

{{define "signup"}}{{template "head" .}}
<h1>запрос доступа</h1>
<form class="stack" method="post" action="/signup">
  <label>имя<input name="name" value="{{.Name}}" autocomplete="username" autofocus></label>
  <button>отправить заявку</button>
</form>
<p class="muted">Пароль задаёшь не сейчас: после одобрения придёт ссылка-приглашение.</p>
{{template "foot" .}}{{end}}

{{define "account"}}{{template "head" .}}
<h1>аккаунт</h1>
<p class="muted">{{.User.User}} · роль {{.User.Role}}</p>
<section>
  <h2>сменить пароль</h2>
  <form class="stack" method="post" action="/account/password">
    <label>текущий пароль<input name="current" type="password" autocomplete="current-password"></label>
    <label>новый пароль<input name="password" type="password" autocomplete="new-password"></label>
    <button>сохранить</button>
  </form>
</section>
{{template "foot" .}}{{end}}

{{define "admin"}}{{template "head" .}}
<h1>админка</h1>
<section>
  <h2>заявки</h2>
  {{if .Pending}}
  <table>
    <thead><tr><th>имя</th><th>что сделать</th></tr></thead>
    <tbody>
    {{range .Pending}}
      <tr>
        <td class="mono">{{.Name}}</td>
        <td class="row-actions">
          <form method="post" action="/admin/approve"><input type="hidden" name="name" value="{{.Name}}"><button>одобрить</button></form>
          <form method="post" action="/admin/reject"><input type="hidden" name="name" value="{{.Name}}"><button class="bad">отклонить</button></form>
        </td>
      </tr>
    {{end}}
    </tbody>
  </table>
  {{else}}<p class="muted">заявок нет</p>{{end}}
</section>
<section>
  <h2>приглашённые</h2>
  {{if .Invited}}
  <table>
    <thead><tr><th>имя</th><th>ссылка</th></tr></thead>
    <tbody>
    {{range .Invited}}
      <tr>
        <td class="mono">{{.Name}}</td>
        <td class="mono"><a href="/i/{{.Token}}">/i/{{.Token}}</a></td>
      </tr>
    {{end}}
    </tbody>
  </table>
  {{else}}<p class="muted">никого</p>{{end}}
</section>
<section>
  <h2>активные</h2>
  <table>
    <thead><tr><th>имя</th><th>роль</th><th></th></tr></thead>
    <tbody>
    {{range .Users}}
      <tr>
        <td class="mono">{{.Name}}</td>
        <td class="muted">{{.Role}}</td>
        <td class="row-actions">
          <form method="post" action="/admin/reject"><input type="hidden" name="name" value="{{.Name}}"><button class="bad">удалить</button></form>
        </td>
      </tr>
    {{end}}
    </tbody>
  </table>
</section>
{{template "foot" .}}{{end}}

{{define "invite"}}{{template "head" .}}
<h1>приглашение</h1>
<p class="muted">имя: {{.Name}}</p>
<form class="stack" method="post" action="/i/{{.Token}}">
  <label>пароль<input name="password" type="password" autocomplete="new-password" autofocus></label>
  <label>ещё раз<input name="confirm" type="password" autocomplete="new-password"></label>
  <button>задать пароль</button>
</form>
{{template "foot" .}}{{end}}

{{define "empty"}}{{template "head" .}}
<h1>{{.Title}}</h1>
<p class="muted">Страница не найдена или маршрут закрыт. <a href="/">на главную</a></p>
{{template "foot" .}}{{end}}
`
