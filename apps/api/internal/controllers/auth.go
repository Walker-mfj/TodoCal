package controllers

import (
	"github.com/google/uuid"
	"net"
	"net/http"

	"focuscalendar/internal/dto"
	"focuscalendar/internal/models"
	"focuscalendar/internal/services"
)

type User = models.User
type Principal = models.Principal

func (s *Server) authService() *services.Auth { return &services.Auth{Pool: s.pool, Now: s.now} }
func clientIP(r *http.Request) string {
	ip, _, e := net.SplitHostPort(r.RemoteAddr)
	if e != nil {
		return r.RemoteAddr
	}
	return ip
}
func (s *Server) sendSession(w http.ResponseWriter, status int, u User, token, csrf, refresh, browserID string) {
	http.SetCookie(w, &http.Cookie{Name: "focus_session", Value: token, Path: "/", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: 60 * 60})
	http.SetCookie(w, &http.Cookie{Name: "focus_refresh", Value: refresh, Path: "/api/v1/auth", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: 30 * 24 * 60 * 60})
	if browserID != "" {
		http.SetCookie(w, &http.Cookie{Name: "focus_device", Value: browserID, Path: "/api/v1/auth", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: 400 * 24 * 60 * 60})
	}
	writeJSON(w, status, map[string]any{"user": u, "csrfToken": csrf})
}
func (s *Server) Register(w http.ResponseWriter, r *http.Request) {
	var in dto.Credentials
	if !decode(w, r, &in) {
		return
	}
	out, e := s.authService().Register(r.Context(), services.Credentials{Email: in.Email, Password: in.Password, Timezone: in.Timezone, BrowserID: browserIdentity(r)}, clientIP(r))
	if e != nil {
		domainError(w, e)
		return
	}
	s.sendSession(w, 201, out.User, out.Token, out.CSRF, out.Refresh, out.BrowserID)
}
func (s *Server) Login(w http.ResponseWriter, r *http.Request) {
	var in dto.Credentials
	if !decode(w, r, &in) {
		return
	}
	out, e := s.authService().Login(r.Context(), services.Credentials{Email: in.Email, Password: in.Password, Timezone: in.Timezone, BrowserID: browserIdentity(r)}, clientIP(r))
	if e != nil {
		domainError(w, e)
		return
	}
	s.sendSession(w, 200, out.User, out.Token, out.CSRF, out.Refresh, out.BrowserID)
}
func (s *Server) authenticate(w http.ResponseWriter, r *http.Request) (Principal, bool) {
	var p Principal
	c, e := r.Cookie("focus_session")
	if e != nil || len(c.Value) != 64 {
		fail(w, 401, "unauthenticated", "Please sign in")
		return p, false
	}
	p, e = s.authService().Authenticate(r.Context(), c.Value)
	if e != nil {
		domainError(w, e)
		return p, false
	}
	if r.Method != "GET" && !equal(tokenHash(r.Header.Get("X-CSRF-Token")), p.CSRFHash) {
		fail(w, 403, "csrf", "Refresh the page and try again")
		return p, false
	}
	w.Header().Set("X-Account-ID", p.ID)
	return p, true
}
func (s *Server) Me(w http.ResponseWriter, r *http.Request) {
	p, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	out, e := s.authService().Me(r.Context(), p)
	if e != nil {
		domainError(w, e)
		return
	}
	writeJSON(w, 200, out)
}
func (s *Server) Logout(w http.ResponseWriter, r *http.Request) {
	p, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	if e := s.authService().Logout(r.Context(), p); e != nil {
		domainError(w, e)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "focus_session", Value: "", Path: "/", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	http.SetCookie(w, &http.Cookie{Name: "focus_refresh", Value: "", Path: "/api/v1/auth", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (s *Server) Password(w http.ResponseWriter, r *http.Request) {
	p, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var in dto.PasswordInput
	if !decode(w, r, &in) {
		return
	}
	if e := s.authService().Password(r.Context(), p, services.PasswordInput{OldPassword: in.OldPassword, NewPassword: in.NewPassword}, clientIP(r)); e != nil {
		domainError(w, e)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// The security middleware requires same-origin JSON POSTs, including when the
// access cookie (and its CSRF token) has expired.
func (s *Server) Refresh(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("focus_refresh")
	if err != nil || len(c.Value) != 64 {
		fail(w, 401, "unauthenticated", "Please sign in")
		return
	}
	out, err := s.authService().Refresh(r.Context(), c.Value)
	if err != nil {
		domainError(w, err)
		return
	}
	s.sendSession(w, 200, out.User, out.Token, out.CSRF, out.Refresh, out.BrowserID)
}

func browserIdentity(r *http.Request) string {
	if c, e := r.Cookie("focus_device"); e == nil {
		if id, e := uuid.Parse(c.Value); e == nil && id != uuid.Nil {
			return id.String()
		}
	}
	return uuid.NewString()
}
