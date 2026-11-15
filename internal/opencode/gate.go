package opencode

import (
	"os"
	"sync"
	"time"

	"nitgui/internal/gateid"
)

var (
	gateOnce sync.Once
	gateKey  []byte
	gateMu   sync.Mutex
	gateID   string
	gateExp  time.Time
)

func gateHeader() string {
	gateOnce.Do(func() {
		path := gateid.DefaultSecretPath()
		if _, err := os.Stat(path); err != nil {
			return
		}
		key, err := gateid.LoadSecret(path)
		if err == nil {
			gateKey = key
		}
	})
	if len(gateKey) == 0 {
		return ""
	}
	gateMu.Lock()
	defer gateMu.Unlock()
	now := time.Now()
	if gateID != "" && now.Before(gateExp) {
		return gateID
	}
	id := gateid.Identity{
		User: "nit-gui",
		Role: gateid.RoleAdmin,
		Caps: gateid.Caps(gateid.RoleAdmin),
		Exp:  now.Add(2 * time.Minute).Unix(),
	}
	gateID = gateid.Sign(gateKey, id)
	gateExp = now.Add(30 * time.Second)
	return gateID
}
