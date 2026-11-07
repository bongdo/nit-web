package opencode

import "testing"

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
