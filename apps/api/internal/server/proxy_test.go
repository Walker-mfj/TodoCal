package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProxyBoundary(t *testing.T) {
	secret := strings.Repeat("a", 64)
	for _, tc := range []struct {
		name, path, token, ip string
		status                int
		addr                  string
	}{
		{"reject missing token", "/api/v1/auth/me", "", "", 403, ""},
		{"reject wrong token", "/api/v1/auth/me", "wrong", "203.0.113.9", 403, ""},
		{"trusted address", "/api/v1/auth/me", secret, "203.0.113.9", 200, "203.0.113.9:0"},
		{"invalid address", "/api/v1/auth/me", secret, "spoof", 403, ""},
		{"health remains public", "/healthz", "", "", 200, "192.0.2.1:1234"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.RemoteAddr != tc.addr {
					t.Errorf("address=%s", r.RemoteAddr)
				}
				w.WriteHeader(200)
			})
			r := httptest.NewRequest("GET", tc.path, nil)
			r.RemoteAddr = "192.0.2.1:1234"
			r.Header.Set("X-TodoCal-Proxy-Secret", tc.token)
			r.Header.Set("X-TodoCal-Client-IP", tc.ip)
			w := httptest.NewRecorder()
			ProxyHandler(next, secret).ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status=%d want %d", w.Code, tc.status)
			}
		})
	}
}
