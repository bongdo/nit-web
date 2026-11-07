package opencode

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidSSHHost(t *testing.T) {
	valid := []string{"riga-dev", "user@host", "[::1]", "host.example.com", "host_1"}
	for _, host := range valid {
		if !ValidSSHHost(host) {
			t.Errorf("ValidSSHHost(%q) = false", host)
		}
	}
	invalid := []string{"", "-oProxyCommand=touch /tmp/x", "host name", "host;rm -rf /", "host\nname", "-"}
	for _, host := range invalid {
		if ValidSSHHost(host) {
			t.Errorf("ValidSSHHost(%q) = true", host)
		}
	}
}

func TestLoadInstancesRejectsSSHOption(t *testing.T) {
	path := filepath.Join(t.TempDir(), "instances.json")
	raw := `{"instances":[{"name":"local"},{"name":"evil","ssh":"-oProxyCommand=touch /tmp/x"}]}`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("NIT_GUI_INSTANCES", path)
	registry := NewRegistry()
	defer registry.Close()
	if !strings.Contains(registry.ConfigError(), "invalid ssh host") {
		t.Fatalf("config error = %q", registry.ConfigError())
	}
	if len(registry.Instances()) != 1 || registry.Instances()[0].Name != "local" {
		t.Fatalf("instances = %+v", registry.Instances())
	}
}
