package controllers

import (
	"github.com/google/uuid"
	"testing"
)

func TestWorkspaceSettingsAtomicSave(t *testing.T) {
	s, _ := testServer(t)
	c, csrf := register(t, s, "workspace@example.com")
	body := map[string]any{"settings": map[string]any{"expectedRevision": 1, "appearance": "dark", "soundVolume": 85}, "notifications": map[string]any{"expectedRevision": 2, "taskStart": true, "leadMinutes": 5, "quietStart": "", "quietEnd": ""}}
	w := command(s, "PATCH", "/api/v1/settings/workspace", body, c, csrf, uuid.NewString())
	if w.Code != 409 {
		t.Fatal("expected conflict", w.Code, w.Body)
	}
	got := object(t, req(s, "GET", "/api/v1/settings", nil, c, ""), 200)
	if got["appearance"] != "light" || got["revision"] != float64(1) {
		t.Fatal("partial save", got)
	}
	body["notifications"].(map[string]any)["expectedRevision"] = 1
	key := uuid.NewString()
	saved := object(t, command(s, "PATCH", "/api/v1/settings/workspace", body, c, csrf, key), 200)
	if saved["settings"].(map[string]any)["soundVolume"] != float64(85) || saved["notifications"].(map[string]any)["taskStart"] != true {
		t.Fatal(saved)
	}
	object(t, command(s, "PATCH", "/api/v1/settings/workspace", body, c, csrf, key), 200)
}
