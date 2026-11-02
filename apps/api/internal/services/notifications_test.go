package services

import (
	"encoding/base64"
	"net/netip"
	"strings"
	"testing"
	"time"
)

func TestPushEndpointSafety(t *testing.T) {
	for _, v := range []string{"http://fcm.googleapis.com/a", "https://localhost/a", "https://127.0.0.1/a", "https://fcm.googleapis.com.evil.test/a", "https://user@fcm.googleapis.com/a", "https://fcm.googleapis.com:444/a", "https://fcm.googleapis.com/a#secret"} {
		if validPushEndpoint(v) {
			t.Errorf("accepted %s", v)
		}
	}
	for _, v := range []string{"https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/abc"} {
		if !validPushEndpoint(v) {
			t.Errorf("rejected %s", v)
		}
	}
}
func TestNotificationPreferencesAndQuietHours(t *testing.T) {
	p := NotificationPreferences{LeadMinutes: 5, QuietStart: "22:00", QuietEnd: "07:00"}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, v := range []struct {
		at    string
		quiet bool
	}{{"2026-11-01T05:30:00Z", true}, {"2026-11-01T06:30:00Z", true}, {"2026-11-01T12:00:00Z", false}} {
		at, _ := time.Parse(time.RFC3339, v.at)
		if p.IsQuiet(at, "America/New_York") != v.quiet {
			t.Fatal(v)
		}
	}
	p.QuietEnd = ""
	if p.Validate() == nil {
		t.Fatal("partial quiet hours accepted")
	}
	p.QuietStart = ""
	p.LeadMinutes = 1441
	if p.Validate() == nil {
		t.Fatal("excessive lead accepted")
	}
}
func TestPushKeysValidated(t *testing.T) {
	in := PushInput{Endpoint: "https://fcm.googleapis.com/fcm/send/a"}
	in.Keys.Auth = base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("a", 16)))
	in.Keys.P256dh = base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat("a", 65)))
	if in.Validate() == nil {
		t.Fatal("invalid elliptic curve point accepted")
	}
}

func TestPushTransportRejectsPrivateAddresses(t *testing.T) {
	for _, v := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "192.168.0.1", "::1", "fc00::1", "::ffff:127.0.0.1", "2001:db8::1"} {
		if publicPushIP(netip.MustParseAddr(v)) {
			t.Fatalf("accepted nonpublic address %s", v)
		}
	}
	if !publicPushIP(netip.MustParseAddr("8.8.8.8")) {
		t.Fatal("public address rejected")
	}
	sender, e := NewWebPushSender("", "", "")
	if e != nil || sender != nil {
		t.Fatal("unconfigured sender must be disabled")
	}
	if _, e = NewWebPushSender("bad", "bad", "mailto:hello@example.com"); e == nil {
		t.Fatal("invalid keys accepted")
	}
}
