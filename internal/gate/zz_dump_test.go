package gate

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"nitgui/internal/gateid"
)

func TestDumpPagesForDiff(t *testing.T) {
	dir := os.Getenv("GATE_DUMP_DIR")
	if dir == "" {
		t.Skip("GATE_DUMP_DIR unset")
	}
	now := time.Unix(1700000000, 0)
	base := view{
		Title: "заголовок",
		User:  gateid.Identity{User: "bongdo", Role: "admin", Caps: []string{"admin.users", "admin.host"}},
		Routes: []routeView{
			{Prefix: "/nit", Note: "приложение", Open: true},
			{Prefix: "/term", Note: "", Open: false, Reason: "нужен вход"},
		},
		Users:        []User{{Name: "bongdo", Role: "admin"}},
		Pending:      []User{{Name: "friend", Role: "member"}},
		Invited:      []User{{Name: "guest", Role: "member", Token: "tok en"}},
		Devices:      []deviceView{{ID: "d1", Name: "ноутбук", IP: "10.0.0.1", Created: "01.01.2024 10:00", Seen: "только что", Current: true}},
		DeviceGroups: []deviceGroup{{User: "bongdo", Devices: []deviceView{{ID: "d1", Name: "ноутбук", IP: "10.0.0.1", Created: "01.01.2024 10:00", Seen: "5 минут назад"}}}},
		Message:      "сообщение",
		Error:        "ошибка",
		Next:         "/account",
		Name:         "bongdo",
		Token:        "tok en",
	}
	cases := map[string]view{}
	for _, name := range []string{"home", "login", "signup", "account", "admin", "invite", "empty"} {
		cases[name] = base
	}
	narrow := base
	narrow.Narrow = true
	cases["login_narrow"] = narrow
	empty := view{Title: "404"}
	cases["empty_anonymous"] = empty
	_ = now
	for name, data := range cases {
		tplName := name
		if i := bytes.IndexByte([]byte(name), '_'); i >= 0 && name != "empty_anonymous" {
			tplName = name[:i]
		}
		if name == "empty_anonymous" {
			tplName = "empty"
		}
		var buf bytes.Buffer
		if err := pages.ExecuteTemplate(&buf, tplName, data); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if err := os.WriteFile(filepath.Join(dir, name+".html"), buf.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
