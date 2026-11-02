package services

import (
	"crypto/ecdh"
	"encoding/base64"
	"focuscalendar/internal/models"
	"net/url"
	"time"
)

type NotificationPreferences models.NotificationPreferences
type PushInput models.PushInput

func validPushEndpoint(endpoint string) bool {
	u, e := url.Parse(endpoint)
	if e != nil || len(endpoint) > 4096 || u.Scheme != "https" || u.User != nil || u.Port() != "" || u.Fragment != "" || u.Path == "" {
		return false
	}
	switch u.Host {
	case "fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com":
		return true
	}
	return false
}
func (p PushInput) Validate() error {
	if !validPushEndpoint(p.Endpoint) {
		return Invalid("Use a supported browser push service")
	}
	key, e := base64.RawURLEncoding.DecodeString(p.Keys.P256dh)
	if e != nil {
		return Invalid("Invalid push key")
	}
	if _, e = ecdh.P256().NewPublicKey(key); e != nil {
		return Invalid("Invalid push key")
	}
	auth, e := base64.RawURLEncoding.DecodeString(p.Keys.Auth)
	if e != nil || len(auth) != 16 {
		return Invalid("Invalid push authentication key")
	}
	return nil
}
func (p NotificationPreferences) Validate() error {
	if p.LeadMinutes < 0 || p.LeadMinutes > 1440 {
		return Invalid("Reminder lead must be 0–1440 minutes")
	}
	if p.QuietStart == "" && p.QuietEnd == "" {
		return nil
	}
	for _, v := range []string{p.QuietStart, p.QuietEnd} {
		if len(v) != 5 {
			return Invalid("Provide both quiet hours as HH:MM")
		}
		if _, e := time.Parse("15:04", v); e != nil {
			return Invalid("Provide both quiet hours as HH:MM")
		}
	}
	if p.QuietStart == p.QuietEnd {
		return Invalid("Quiet hours must have different start and end times")
	}
	return nil
}
func (p NotificationPreferences) IsQuiet(now time.Time, zone string) bool {
	if p.QuietStart == "" {
		return false
	}
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return true
	}
	v := now.In(loc).Format("15:04")
	if p.QuietStart < p.QuietEnd {
		return v >= p.QuietStart && v < p.QuietEnd
	}
	return v >= p.QuietStart || v < p.QuietEnd
}
