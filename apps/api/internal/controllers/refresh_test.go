package controllers

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestRefreshLifecycle(t *testing.T) {
	s, _ := testServer(t)
	now := time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	w := req(s, "POST", "/api/v1/auth/register", map[string]string{"email": "refresh@example.com", "password": "correct horse battery"}, nil, "")
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body)
	}
	cookies := w.Result().Cookies()
	if len(cookies) < 2 {
		t.Fatalf("want access and refresh cookies, got %d", len(cookies))
	}
	access, refresh := cookies[0], cookies[1]
	if access.MaxAge != 3600 || refresh.MaxAge != 30*24*3600 || !refresh.HttpOnly || refresh.Path != "/api/v1/auth" {
		t.Fatal("incorrect credential lifetimes or flags", cookies)
	}
	now = now.Add(2 * time.Hour)
	if w = req(s, "GET", "/api/v1/auth/me", nil, access, ""); w.Code != 401 {
		t.Fatal("expired access accepted")
	}
	original := refresh
	for i := 0; i < 5; i++ {
		w = req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, refresh, "")
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		next := w.Result().Cookies()
		if next[1].Value == refresh.Value {
			t.Fatal("refresh did not rotate")
		}
		access, refresh = next[0], next[1]
		if w = req(s, "GET", "/api/v1/auth/me", nil, access, ""); w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
		now = now.Add(25 * 24 * time.Hour)
	}
	// No absolute 90-day cap: five renewals above reached day 100.
	w = req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, original, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatal("old token replay accepted", w.Code)
	}
	if w = req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, refresh, ""); w.Code != 401 {
		t.Fatal("reused family not revoked", w.Code)
	}
}

func TestRefreshIdleExpiryAndConcurrentRetry(t *testing.T) {
	s, _ := testServer(t)
	now := time.Now().UTC()
	s.now = func() time.Time { return now }
	w := req(s, "POST", "/api/v1/auth/register", map[string]string{"email": "idle@example.com", "password": "correct horse battery"}, nil, "")
	if len(w.Result().Cookies()) < 2 {
		t.Fatal("missing refresh cookie")
	}
	old := w.Result().Cookies()[1]
	w = req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, old, "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	// Lost-response retry / parallel tab within grace stays usable.
	w = req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, old, "")
	if w.Code != 200 {
		t.Fatal("concurrent retry rejected", w.Code, w.Body)
	}
	fresh := w.Result().Cookies()[1]
	now = now.Add(30 * 24 * time.Hour)
	if w = req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, fresh, ""); w.Code != 401 {
		t.Fatal("idle expiry accepted", w.Code)
	}
}

func TestBrowserIdentitySurvivesLogin(t *testing.T) {
	s, pool := testServer(t)
	w := req(s, "POST", "/api/v1/auth/register", map[string]string{"email": "browser@example.com", "password": "correct horse battery"}, nil, "")
	var browser *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "focus_device" {
			browser = c
		}
	}
	if browser == nil {
		t.Fatal("missing persistent browser identity")
	}
	_, err := pool.Exec(context.Background(), `INSERT INTO push_subscriptions(id,user_id,session_id,endpoint,p256dh,auth,created_at,device_name)
 SELECT '00000000-0000-4000-8000-000000000001',user_id,id,'https://fcm.googleapis.com/fcm/send/browser-test','key','auth',now(),'Chrome · macOS' FROM auth_sessions`)
	if err != nil {
		t.Fatal(err)
	}
	w = req(s, "POST", "/api/v1/auth/login", map[string]string{"email": "browser@example.com", "password": "correct horse battery"}, browser, "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	var count int
	if err := pool.QueryRow(context.Background(), "SELECT count(DISTINCT browser_id) FROM auth_sessions").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("browser identity changed at login", count)
	}
	access := w.Result().Cookies()[0]
	body := object(t, w, 200)
	state := object(t, req(s, "GET", "/api/v1/notifications", nil, access, ""), 200)
	devices := state["subscriptions"].([]any)
	if len(devices) != 1 || devices[0].(map[string]any)["currentDevice"] != true {
		t.Fatal("existing consent did not follow browser", state)
	}
	object(t, req(s, "POST", "/api/v1/auth/logout", map[string]any{}, access, body["csrfToken"].(string)), 200)
	refresh := w.Result().Cookies()[1]
	if got := req(s, "POST", "/api/v1/auth/refresh", map[string]any{}, refresh, ""); got.Code != 401 {
		t.Fatal("logout left refresh usable")
	}
	w = req(s, "POST", "/api/v1/auth/login", map[string]string{"email": "browser@example.com", "password": "correct horse battery"}, browser, "")
	object(t, w, 200)
	state = object(t, req(s, "GET", "/api/v1/notifications", nil, w.Result().Cookies()[0], ""), 200)
	if len(state["subscriptions"].([]any)) != 0 {
		t.Fatal("login restored consent revoked by logout", state)
	}

}
