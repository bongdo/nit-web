package gate

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestEveryPageRenders(t *testing.T) {
	server, store := testServer(t, nil)
	client := noRedirect(t)
	if resp := login(t, client, server.URL, "bongdo", "secret-pass"); resp.StatusCode != http.StatusSeeOther {
		t.Fatalf("login = %d", resp.StatusCode)
	}
	if _, err := store.Request("guest"); err != nil {
		t.Fatal(err)
	}
	token, err := store.Approve("guest")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		path string
		code int
		want string
	}{
		{"/", http.StatusOK, "<h1>сервисы</h1>"},
		{"/login", http.StatusOK, "<h1>вход</h1>"},
		{"/signup", http.StatusOK, "<h1>запрос доступа</h1>"},
		{"/account", http.StatusOK, "action=\"/account/password\""},
		{"/admin", http.StatusOK, "<h2>приглашённые</h2>"},
		{"/i/" + token, http.StatusOK, "action=\"/i/" + token + "\""},
		{"/missing", http.StatusNotFound, "Страница не найдена"},
	}
	for _, tc := range cases {
		resp, err := client.Get(server.URL + tc.path)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != tc.code {
			t.Errorf("%s = %d, want %d", tc.path, resp.StatusCode, tc.code)
		}
		if !strings.Contains(string(body), tc.want) {
			t.Errorf("%s does not contain %q, body %d bytes", tc.path, tc.want, len(body))
		}
	}
}
