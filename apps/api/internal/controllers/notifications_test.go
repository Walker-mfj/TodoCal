package controllers

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"github.com/google/uuid"
	"testing"
)

func TestNotificationPreferencesAndDeviceOwnership(t *testing.T) {
	s, _ := testServer(t)
	owner, csrf := register(t, s, "notify-owner@example.com")
	other, otherCSRF := register(t, s, "notify-other@example.com")
	initial := object(t, req(s, "GET", "/api/v1/notifications", nil, owner, ""), 200)
	prefs := initial["preferences"].(map[string]any)
	if prefs["taskStart"] != false || len(initial["subscriptions"].([]any)) != 0 {
		t.Fatal(initial)
	}
	change := map[string]any{"expectedRevision": 1, "taskStart": true, "deadline": true, "leadMinutes": 5, "quietStart": "22:00", "quietEnd": "07:00"}
	key := uuid.NewString()
	object(t, command(s, "PUT", "/api/v1/notifications/preferences", change, owner, "", key), 403)
	saved := object(t, command(s, "PUT", "/api/v1/notifications/preferences", change, owner, csrf, key), 200)
	replay := object(t, command(s, "PUT", "/api/v1/notifications/preferences", change, owner, csrf, key), 200)
	if saved["revision"] != float64(2) || replay["revision"] != saved["revision"] {
		t.Fatal(saved, replay)
	}
	object(t, command(s, "PUT", "/api/v1/notifications/preferences", change, owner, csrf, uuid.NewString()), 409)
	privateKey, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	subscription := map[string]any{"endpoint": "https://fcm.googleapis.com/fcm/send/owner-device", "keys": map[string]string{"p256dh": base64.RawURLEncoding.EncodeToString(privateKey.PublicKey().Bytes()), "auth": base64.RawURLEncoding.EncodeToString(make([]byte, 16))}}
	device := object(t, command(s, "POST", "/api/v1/notifications/subscriptions", subscription, owner, csrf, uuid.NewString()), 201)
	listed := object(t, req(s, "GET", "/api/v1/notifications", nil, owner, ""), 200)["subscriptions"].([]any)
	if len(listed) != 1 || listed[0].(map[string]any)["currentDevice"] != true {
		t.Fatal(listed)
	}
	isolated := object(t, req(s, "GET", "/api/v1/notifications", nil, other, ""), 200)
	if len(isolated["subscriptions"].([]any)) != 0 || isolated["preferences"].(map[string]any)["taskStart"] != false {
		t.Fatal(isolated)
	}
	path := "/api/v1/notifications/subscriptions/" + device["id"].(string)
	object(t, command(s, "DELETE", path, map[string]any{}, other, otherCSRF, uuid.NewString()), 404)
	object(t, command(s, "DELETE", path, map[string]any{}, owner, csrf, uuid.NewString()), 200)
	if got := object(t, req(s, "GET", "/api/v1/notifications", nil, owner, ""), 200)["subscriptions"].([]any); len(got) != 0 {
		t.Fatal(got)
	}
}
