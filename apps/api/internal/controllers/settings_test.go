package controllers

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

func TestSettingsDurationBounds(t *testing.T) {
	s, _ := testServer(t)
	c, csrf := register(t, s, "durations@example.com")
	for _, tc := range []struct {
		field string
		max   int
	}{{"focusMinutes", 180}, {"shortBreakMinutes", 60}, {"longBreakMinutes", 60}} {
		for _, value := range []any{-1, 0, 1.5, tc.max + 1, 2147483647} {
			t.Run(fmt.Sprintf("%s rejects %v", tc.field, value), func(t *testing.T) {
				object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{tc.field: value, "expectedRevision": 1}, c, csrf, uuid.NewString()), 422)
			})
		}
	}
	rev := 1
	for _, field := range []string{"focusMinutes", "shortBreakMinutes", "longBreakMinutes"} {
		max := 60
		if field == "focusMinutes" {
			max = 180
		}
		for _, value := range []int{1, max} {
			result := object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{field: value, "expectedRevision": rev}, c, csrf, uuid.NewString()), 200)
			if result[field] != float64(value) {
				t.Fatal(result)
			}
			rev++
		}
	}
}

func TestFocusRejectsInvalidLegacyDefaults(t *testing.T) {
	s, p := testServer(t)
	c, csrf := register(t, s, "legacy-duration@example.com")
	// Simulate settings accepted by an older API; no active timer may be created.
	_, err := p.Exec(context.Background(), "UPDATE settings SET focus_minutes=181,short_break_minutes=61,long_break_minutes=2147483647")
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"focus", "short_break", "long_break"} {
		t.Run(kind, func(t *testing.T) {
			object(t, command(s, "POST", "/api/v1/focus", map[string]any{"kind": kind}, c, csrf, uuid.NewString()), 422)
		})
	}
	var count int
	if err = p.QueryRow(context.Background(), "SELECT count(*) FROM focus_sessions").Scan(&count); err != nil || count != 0 {
		t.Fatalf("invalid defaults created sessions: %d, %v", count, err)
	}
	// A valid explicit override remains usable while the old setting is corrected.
	active := object(t, command(s, "POST", "/api/v1/focus", map[string]any{"kind": "focus", "durationMinutes": 1}, c, csrf, uuid.NewString()), 201)["active"].(map[string]any)
	if active["targetSeconds"] != float64(60) {
		t.Fatal(active)
	}
}
