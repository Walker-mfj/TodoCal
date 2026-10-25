package server

import (
	"net"
	"net/http"
	"strings"
)

// ProxyHandler only trusts the client address from our authenticated edge proxy.
// An empty secret preserves local development behavior; production sets a secret.
func ProxyHandler(next http.Handler, secret string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if secret != "" && strings.HasPrefix(r.URL.Path, "/api/") {
			ip := net.ParseIP(r.Header.Get("X-TodoCal-Client-IP"))
			if len(secret) < 32 || !equal(r.Header.Get("X-TodoCal-Proxy-Secret"), secret) || ip == nil {
				w.Header().Set("Cache-Control", "no-store")
				fail(w, 403, "proxy", "Request must use the application URL")
				return
			}
			r = r.Clone(r.Context())
			r.RemoteAddr = net.JoinHostPort(ip.String(), "0")
			r.Header.Del("X-TodoCal-Proxy-Secret")
			r.Header.Del("X-TodoCal-Client-IP")
		}
		next.ServeHTTP(w, r)
	})
}
