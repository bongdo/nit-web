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
