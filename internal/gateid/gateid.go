package gateid

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const Header = "X-Gate-Identity"

const (
	ReadPublic  = "read.public"
	ReadPrivate = "read.private"
	WriteOwn    = "write.own"
	WriteShared = "write.shared"
	AdminUsers  = "admin.users"
	AdminHost   = "admin.host"

	RoleAnon   = "anon"
	RoleMember = "member"
	RoleAdmin  = "admin"
)

var roleCaps = map[string][]string{
	RoleAnon:   {ReadPublic},
	RoleMember: {ReadPublic, ReadPrivate, WriteOwn},
	RoleAdmin:  {ReadPublic, ReadPrivate, WriteOwn, WriteShared, AdminUsers, AdminHost},
}

type Identity struct {
	User  string   `json:"u"`
	Role  string   `json:"r"`
	Caps  []string `json:"c"`
	Exp   int64    `json:"exp"`
	Dev   string   `json:"d,omitempty"`
	Temp  bool     `json:"t,omitempty"`
	Epoch string   `json:"e,omitempty"`
}

func Caps(role string) []string {
	caps, ok := roleCaps[role]
	if !ok {
		return nil
	}
	return append([]string(nil), caps...)
}

func (id Identity) Has(capability string) bool {
	for _, c := range id.Caps {
		if c == capability {
			return true
		}
	}
	return false
}

func (id Identity) Anonymous() bool {
	return id.User == ""
}

func Sign(secret []byte, id Identity) string {
	payload, err := json.Marshal(id)
	if err != nil {
		return ""
	}
	body := base64.RawURLEncoding.EncodeToString(payload)
	return body + "." + signature(secret, body)
}

func Verify(secret []byte, value string, now time.Time) (Identity, error) {
	body, sig, ok := strings.Cut(value, ".")
	if !ok || body == "" || sig == "" {
		return Identity{}, errors.New("gateid: malformed identity")
	}
	if !hmac.Equal([]byte(sig), []byte(signature(secret, body))) {
		return Identity{}, errors.New("gateid: bad signature")
	}
	payload, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return Identity{}, errors.New("gateid: bad payload")
	}
	var id Identity
	if err := json.Unmarshal(payload, &id); err != nil {
		return Identity{}, errors.New("gateid: bad payload")
	}
	if id.Exp != 0 && now.Unix() > id.Exp {
		return Identity{}, errors.New("gateid: expired")
	}
	return id, nil
}

func From(r *http.Request, secret []byte) (Identity, bool) {
	value := strings.TrimSpace(r.Header.Get(Header))
	if value == "" {
		return Identity{}, false
	}
	id, err := Verify(secret, value, time.Now())
	if err != nil {
		return Identity{}, false
	}
	return id, true
}

func signature(secret []byte, body string) string {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(body))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func DefaultSecretPath() string {
	if path := strings.TrimSpace(os.Getenv("NIT_GATE_KEY")); path != "" {
		return path
	}
	config, err := os.UserConfigDir()
	if err != nil {
		return "gate.key"
	}
	return filepath.Join(config, "nit-gui", "gate.key")
}

func ReadSecret(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	secret := []byte(strings.TrimSpace(string(data)))
	if len(secret) < 32 {
		return nil, errors.New("gateid: key is too short")
	}
	return secret, nil
}

func LoadSecret(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err == nil {
		secret := []byte(strings.TrimSpace(string(data)))
		if len(secret) < 32 {
			return nil, errors.New("gateid: key is too short")
		}
		return secret, nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	encoded := []byte(base64.RawURLEncoding.EncodeToString(secret))
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		return nil, err
	}
	return encoded, nil
}
