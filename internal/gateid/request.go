package gateid

import (
	"net"
	"net/http"
	"strings"
)

func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if host == "127.0.0.1" || host == "::1" {
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			for _, part := range strings.Split(forwarded, ",") {
				if ip := strings.TrimSpace(part); ip != "" {
					return ip
				}
			}
		}
	}
	return host
}

func SafeNext(raw string) string {
	if raw == "" || !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.HasPrefix(raw, "/\\") {
		return "/"
	}
	for _, r := range raw {
		if r < 0x20 || r == 0x7f || r == '\\' {
			return "/"
		}
	}
	return raw
}
