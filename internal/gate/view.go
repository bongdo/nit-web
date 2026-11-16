package gate

import (
	"embed"
	"html/template"
	"net/http"
	"strconv"
	"time"

	"nitgui/internal/gateid"
)

//go:embed views/*.html
var viewFiles embed.FS

var pages = template.Must(template.ParseFS(viewFiles, "views/*.html"))

const onlineWindow = 5 * time.Minute

type routeView struct {
	Prefix  string
	Note    string
	State   string
	Href    string
	Preview string
	Key     int
}

type deviceView struct {
	ID      string
	Short   string
	Name    string
	IP      string
	Created string
	Seen    string
	Current bool
	Unknown bool
	Online  bool
}

type deviceGroup struct {
	User    string
	Count   string
	Devices []deviceView
}

type auditView struct {
	When   string
	User   string
	IP     string
	Agent  string
	Result string
	Failed bool
	Temp   bool
}

type dropView struct {
	Name   string
	Href   string
	Kind   string
	Site   bool
	Public bool
}

type view struct {
	Title        string
	Narrow       bool
	User         gateid.Identity
	Routes       []routeView
	Services     string
	Users        []User
	Pending      []User
	Invited      []User
	Devices      []deviceView
	DeviceGroups []deviceGroup
	Log          []auditView
	Drop         []dropView
	Health       serverHealth
	HasHealth    bool
	Message      string
	Error        string
	Next         string
	Name         string
	Token        string
	Origin       string
	PendingToken string
	QR           qrView
	TOTPOn       bool
	TOTPSecret   string
	TOTPQR       template.URL
	TOTPPending  string
	Recovery     []string
	RecoveryLeft int
}

func (s *Server) newView(r *http.Request, title string) view {
	scheme := "http"
	if s.secure(r) {
		scheme = "https"
	}
	return view{Title: title, User: identity(r), Origin: scheme + "://" + r.Host}
}

func (s *Server) newNarrow(r *http.Request, title string) view {
	data := s.newView(r, title)
	data.Narrow = true
	return data
}

func (s *Server) render(w http.ResponseWriter, name string, data view) {
	s.renderStatus(w, name, data, http.StatusOK)
}

func (s *Server) renderStatus(w http.ResponseWriter, name string, data view, status int) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Frame-Options", "DENY")
	w.WriteHeader(status)
	if err := pages.ExecuteTemplate(w, name, data); err != nil {
		s.log.Error("gate page failed", "page", name, "error", err)
	}
}

func deviceViews(devices []Device, current string, now time.Time) []deviceView {
	views := make([]deviceView, 0, len(devices))
	for _, device := range devices {
		views = append(views, deviceViewOf(device, current, now))
	}
	return views
}

func deviceViewOf(device Device, current string, now time.Time) deviceView {
	name := device.Name
	unknown := name == "" || name == unknownDevice
	if unknown {
		name = "неизвестное устройство"
	}
	return deviceView{
		ID:      device.ID,
		Short:   shortID(device.ID),
		Name:    name,
		IP:      device.IP,
		Created: time.Unix(device.Created, 0).Format("02.01.06 15:04"),
		Seen:    ago(time.Unix(device.Seen, 0), now),
		Current: device.ID == current,
		Unknown: unknown,
		Online:  now.Sub(time.Unix(device.Seen, 0)) < onlineWindow,
	}
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

func deviceGroups(devices []Device, current string, now time.Time) []deviceGroup {
	groups := make([]deviceGroup, 0, len(devices))
	position := map[string]int{}
	for _, device := range devices {
		index, ok := position[device.User]
		if !ok {
			index = len(groups)
			position[device.User] = index
			groups = append(groups, deviceGroup{User: device.User})
		}
		groups[index].Devices = append(groups[index].Devices, deviceViewOf(device, current, now))
	}
	for i := range groups {
		groups[i].Count = plural(len(groups[i].Devices), "устройство", "устройства", "устройств")
	}
	return groups
}

func ago(then, now time.Time) string {
	elapsed := now.Sub(then)
	switch {
	case elapsed < time.Minute:
		return "только что"
	case elapsed < time.Hour:
		return plural(int(elapsed/time.Minute), "минуту", "минуты", "минут") + " назад"
	case elapsed < 24*time.Hour:
		return plural(int(elapsed/time.Hour), "час", "часа", "часов") + " назад"
	default:
		return plural(int(elapsed/(24*time.Hour)), "день", "дня", "дней") + " назад"
	}
}

func plural(n int, one, few, many string) string {
	switch {
	case n%100 >= 11 && n%100 <= 14:
		return strconv.Itoa(n) + " " + many
	case n%10 == 1:
		return strconv.Itoa(n) + " " + one
	case n%10 >= 2 && n%10 <= 4:
		return strconv.Itoa(n) + " " + few
	default:
		return strconv.Itoa(n) + " " + many
	}
}

func passwordError(err error) string {
	if err == ErrBadPassword {
		return "пароль: минимум 8 символов"
	}
	return err.Error()
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
