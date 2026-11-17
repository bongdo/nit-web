package gateid

import (
	"encoding/base64"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestSignVerify(t *testing.T) {
	secret := []byte("0123456789abcdef0123456789abcdef")
	id := Identity{User: "bongdo", Role: RoleAdmin, Caps: Caps(RoleAdmin), Exp: time.Now().Add(time.Minute).Unix(), Dev: "device-1"}
	value := Sign(secret, id)
	got, err := Verify(secret, value, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if got.User != "bongdo" || !got.Has(AdminHost) || got.Dev != "device-1" {
		t.Fatalf("identity = %+v", got)
	}
}

func TestVerifyIdentityWithoutDevice(t *testing.T) {
	secret := []byte("0123456789abcdef0123456789abcdef")
	payload := `{"u":"old","r":"member","c":["read.public"],"exp":` + strconv.FormatInt(time.Now().Add(time.Minute).Unix(), 10) + `}`
	body := base64.RawURLEncoding.EncodeToString([]byte(payload))
	id, err := Verify(secret, body+"."+signature(secret, body), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if id.User != "old" || id.Dev != "" {
		t.Fatalf("identity = %+v", id)
	}
}

func TestVerifyRejects(t *testing.T) {
	secret := []byte("0123456789abcdef0123456789abcdef")
	other := []byte("ffffffffffffffffffffffffffffffff")
	id := Identity{User: "bongdo", Role: RoleAdmin, Caps: Caps(RoleAdmin), Exp: time.Now().Add(time.Minute).Unix()}
	value := Sign(secret, id)

	if _, err := Verify(other, value, time.Now()); err == nil {
		t.Fatal("foreign key accepted")
	}
	if _, err := Verify(secret, value+"x", time.Now()); err == nil {
		t.Fatal("tampered signature accepted")
	}
	if _, err := Verify(secret, "garbage", time.Now()); err == nil {
		t.Fatal("garbage accepted")
	}
	expired := Sign(secret, Identity{User: "bongdo", Exp: time.Now().Add(-time.Second).Unix()})
	if _, err := Verify(secret, expired, time.Now()); err == nil {
		t.Fatal("expired identity accepted")
	}
}

func TestCapsByRole(t *testing.T) {
	anon := Caps(RoleAnon)
	if len(anon) != 1 || anon[0] != ReadPublic {
		t.Fatalf("anon caps = %v", anon)
	}
	member := Identity{Role: RoleMember, Caps: Caps(RoleMember)}
	if !member.Has(WriteOwn) || member.Has(AdminHost) || member.Has(AdminUsers) {
		t.Fatalf("member caps = %v", member.Caps)
	}
	admin := Identity{Role: RoleAdmin, Caps: Caps(RoleAdmin)}
	for _, capability := range []string{ReadPublic, ReadPrivate, WriteOwn, WriteShared, AdminUsers, AdminHost} {
		if !admin.Has(capability) {
			t.Fatalf("admin is missing %s", capability)
		}
	}
}

func TestFromRequest(t *testing.T) {
	secret := []byte("0123456789abcdef0123456789abcdef")
	id := Identity{User: "bongdo", Role: RoleAdmin, Caps: Caps(RoleAdmin), Exp: time.Now().Add(time.Minute).Unix()}
	r := httptest.NewRequest("GET", "/", nil)
	if _, ok := From(r, secret); ok {
		t.Fatal("anonymous request has an identity")
	}
	r.Header.Set(Header, Sign(secret, id))
	got, ok := From(r, secret)
	if !ok || got.User != "bongdo" {
		t.Fatalf("identity = %+v ok=%v", got, ok)
	}
}

func TestClientIP(t *testing.T) {
	direct := httptest.NewRequest("GET", "/", nil)
	direct.RemoteAddr = "203.0.113.9:5555"
	if got := ClientIP(direct); got != "203.0.113.9" {
		t.Fatalf("direct ip = %q", got)
	}

	proxied := httptest.NewRequest("GET", "/", nil)
	proxied.RemoteAddr = "127.0.0.1:5555"
	proxied.Header.Set("X-Forwarded-For", "198.51.100.4, 10.0.0.1")
	if got := ClientIP(proxied); got != "198.51.100.4" {
		t.Fatalf("proxied ip = %q", got)
	}

	loopback := httptest.NewRequest("GET", "/", nil)
	loopback.RemoteAddr = "[::1]:5555"
	if got := ClientIP(loopback); got != "::1" {
		t.Fatalf("loopback ip = %q", got)
	}
}

func TestSafeNext(t *testing.T) {
	cases := map[string]string{
		"":                 "/",
		"//evil.com":       "/",
		"/\\evil.com":      "/",
		"https://evil.com": "/",
		"\x01/x":           "/",
		"/nit/files/":      "/nit/files/",
	}
	for raw, want := range cases {
		if got := SafeNext(raw); got != want {
			t.Fatalf("SafeNext(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestLoadSecretCreatesOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gate.key")
	first, err := LoadSecret(path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("key mode = %o", info.Mode().Perm())
	}
	second, err := LoadSecret(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != string(second) {
		t.Fatal("key changed on reload")
	}
	read, err := ReadSecret(path)
	if err != nil || string(read) != string(first) {
		t.Fatalf("read = %q err = %v", read, err)
	}
}
