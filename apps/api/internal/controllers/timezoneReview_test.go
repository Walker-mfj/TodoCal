package controllers

import (
	"context"
	"github.com/google/uuid"
	"testing"
	"time"
)

func TestLazyCatchupAfterTimezoneChangeBuildsCompleteSnapshot(t *testing.T) {
	s, _ := testServer(t)
	now := time.Date(2030, 11, 30, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "lazy-zone@example.com")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Tokyo", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Lazy Tokyo", "scheduledDate": "2030-12-01", "startTime": "01:30", "endTime": "02:00"}, "cadence": "daily"}, c, csrf, uuid.NewString()), 201)
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Ho_Chi_Minh", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	normal := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Other task", "scheduledDate": "2030-12-04"}, c, csrf, uuid.NewString()), 201)
	object(t, command(s, "POST", "/api/v1/tasks/"+normal["id"].(string)+"/completion", map[string]any{"complete": true, "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	now = time.Date(2030, 12, 6, 12, 0, 0, 0, time.UTC)
	renewTestSession(t, s, c, &csrf)
	for i := 0; i < 2; i++ {
		out := calendar(t, s, c, "2030-12-04", "2030-12-05")
		day := out["days"].([]any)[0].(map[string]any)
		if day["planned"] != float64(2) || day["completed"] != float64(1) || day["percentage"] != float64(50) || len(day["entries"].([]any)) != 2 {
			t.Fatal("partial snapshot", day)
		}
		if len(out["tasks"].([]any)) != 0 {
			t.Fatal("history leaked into live calendar", out)
		}
	}
}

func TestSeriesEditsProtectHistoricalAttributionAfterForwardZoneChange(t *testing.T) {
	for _, scope := range []string{"all", "following"} {
		t.Run(scope, func(t *testing.T) {
			s, _ := testServer(t)
			s.now = func() time.Time { return time.Date(2030, 12, 2, 0, 0, 0, 0, time.UTC) }
			c, csrf := register(t, s, "protected-"+scope+"@example.com")
			object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Pacific/Honolulu", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
			object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Original", "scheduledDate": "2030-12-01", "startTime": "23:30", "endTime": "23:45"}, "cadence": "daily"}, c, csrf, uuid.NewString()), 201)
			items := calendar(t, s, c, "2030-12-01", "2030-12-04")["tasks"].([]any)
			selected := items[0].(map[string]any)
			future := items[1].(map[string]any)
			object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Tokyo", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
			object(t, command(s, "PATCH", "/api/v1/tasks/"+selected["id"].(string), map[string]any{"title": "Forbidden", "scope": scope, "expectedRevision": 1, "expectedSeriesRevision": 1}, c, csrf, uuid.NewString()), 422)
			if scope == "all" {
				object(t, command(s, "PATCH", "/api/v1/tasks/"+future["id"].(string), map[string]any{"title": "Future edit", "scope": "all", "expectedRevision": 1, "expectedSeriesRevision": 1}, c, csrf, uuid.NewString()), 200)
			}
			old := object(t, req(s, "GET", "/api/v1/tasks/"+selected["id"].(string), nil, c, ""), 200)
			if old["title"] != "Original" || old["revision"] != float64(1) {
				t.Fatal("bulk edit changed historical task", old)
			}
			out := calendar(t, s, c, "2030-12-01", "2030-12-03")
			day := out["days"].([]any)[0].(map[string]any)
			if day["timezone"] != "Pacific/Honolulu" || day["planned"] != float64(1) {
				t.Fatal("history changed", day)
			}
			for _, item := range out["tasks"].([]any) {
				if item.(map[string]any)["id"] == selected["id"] {
					t.Fatal("historical identity in live calendar", item)
				}
			}
		})
	}
}

func TestScheduleRoundTripPreservesFallBackDuration(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2026-10-30") }
	c, csrf := register(t, s, "schedule-fold@example.com")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "America/New_York", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	task := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Two hours", "scheduledDate": "2026-10-31", "startTime": "00:30", "endTime": "02:30"}, c, csrf, uuid.NewString()), 201)
	out := object(t, command(s, "POST", "/api/v1/tasks/"+task["id"].(string)+"/schedule", map[string]any{"scheduledDate": "2026-11-01", "startTime": "00:30", "endTime": "01:30", "scheduledStartAt": "2026-11-01T04:30:00Z", "scheduledEndAt": "2026-11-01T06:30:00Z", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	moved := out["task"].(map[string]any)
	start, err := time.Parse(time.RFC3339, moved["scheduledStartAt"].(string))
	if err != nil {
		t.Fatal(err)
	}
	end, err := time.Parse(time.RFC3339, moved["scheduledEndAt"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if end.Sub(start) != 120*time.Minute {
		t.Fatal("duration changed after schedule round trip", moved)
	}
}

func TestHistoricalOvernightRemainsVisibleWithoutItsStartDay(t *testing.T) {
	s, _ := testServer(t)
	now := atDate("2030-12-01")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "historical-overlap@example.com")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Tokyo", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	task := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Historical overnight", "scheduledDate": "2030-12-01", "scheduledEndDate": "2030-12-02", "startTime": "23:30", "endTime": "02:00"}, c, csrf, uuid.NewString()), 201)
	now = atDate("2030-12-03")
	renewTestSession(t, s, c, &csrf)
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Ho_Chi_Minh", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	out := calendar(t, s, c, "2030-12-02", "2030-12-03")
	history := out["overlappingHistory"].([]any)
	if len(out["tasks"].([]any)) != 0 || len(history) != 1 || len(out["days"].([]any)) != 1 {
		t.Fatal("lost overnight snapshot", out)
	}
	day := history[0].(map[string]any)
	saved := day["entries"].([]any)[0].(map[string]any)["task"].(map[string]any)
	if day["date"] != "2030-12-01" || day["timezone"] != "Asia/Tokyo" || saved["id"] != task["id"] {
		t.Fatal("snapshot changed", day)
	}
}

func TestSeriesSchedulePatchPreservesSelectedFallBackInstants(t *testing.T) {
	for _, scope := range []string{"all", "following"} {
		t.Run(scope, func(t *testing.T) {
			s, _ := testServer(t)
			s.now = func() time.Time { return atDate("2026-10-30") }
			c, csrf := register(t, s, "series-fold-"+scope+"@example.com")
			object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "America/New_York", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
			object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Two hours", "scheduledDate": "2026-10-31", "startTime": "00:30", "endTime": "02:30"}, "cadence": "daily"}, c, csrf, uuid.NewString()), 201)
			task := calendar(t, s, c, "2026-10-31", "2026-11-01")["tasks"].([]any)[0].(map[string]any)
			moved := object(t, command(s, "PATCH", "/api/v1/tasks/"+task["id"].(string), map[string]any{"scope": scope, "expectedSeriesRevision": 1, "scheduledDate": "2026-11-01", "startTime": "00:30", "endTime": "01:30", "scheduledStartAt": "2026-11-01T04:30:00Z", "scheduledEndAt": "2026-11-01T06:30:00Z", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
			if moved["scheduledStartAt"] != "2026-11-01T04:30:00Z" || moved["scheduledEndAt"] != "2026-11-01T06:30:00Z" {
				t.Fatal("selected recurrence lost exact interval", moved)
			}
		})
	}
}

func TestReopenedDateIncludesAndSettlesNewContributions(t *testing.T) {
	s, _ := testServer(t)
	now := time.Date(2030, 12, 1, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "reopened@example.com")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Tokyo", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Original", "scheduledDate": "2030-12-01"}, c, csrf, uuid.NewString()), 201)
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "New contribution", "scheduledDate": "2030-12-02", "startTime": "01:30", "endTime": "01:45"}, c, csrf, uuid.NewString()), 201)
	now = time.Date(2030, 12, 1, 15, 10, 0, 0, time.UTC)
	renewTestSession(t, s, c, &csrf)
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Ho_Chi_Minh", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	for i := 0; i < 2; i++ {
		day := calendar(t, s, c, "2030-12-01", "2030-12-02")["days"].([]any)[0].(map[string]any)
		if day["planned"] != float64(2) || len(day["entries"].([]any)) != 2 || day["timezone"] != "Asia/Tokyo" {
			t.Fatal("lost contribution", day)
		}
		now = time.Date(2030, 12, 1, 18, 0, 0, 0, time.UTC)
		renewTestSession(t, s, c, &csrf)
	}
}

func TestStopPreservesOccurrenceFinalizedInAnotherZone(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return time.Date(2030, 12, 1, 13, 0, 0, 0, time.UTC) }
	c, csrf := register(t, s, "stop-history-zone@example.com")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Tokyo", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	sr := object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Protected", "scheduledDate": "2030-12-02", "startTime": "00:30", "endTime": "01:00"}, "cadence": "daily"}, c, csrf, uuid.NewString()), 201)
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Ho_Chi_Minh", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Pacific/Auckland", "expectedRevision": 3}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/series/"+sr["id"].(string)+"/stop", map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	day := calendar(t, s, c, "2030-12-01", "2030-12-02")["days"].([]any)[0].(map[string]any)
	if day["planned"] != float64(1) || day["timezone"] != "Asia/Ho_Chi_Minh" {
		t.Fatal("stop removed accepted occurrence", day)
	}
}

func TestLateCreatedTaskSurvivesRetroactiveSnapshotCutoff(t *testing.T) {
	s, _ := testServer(t)
	now := time.Date(2030, 12, 1, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "late-contribution@example.com")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Tokyo", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Old plan", "scheduledDate": "2030-12-01"}, c, csrf, uuid.NewString()), 201)
	now = time.Date(2030, 12, 2, 0, 0, 0, 0, time.UTC)
	renewTestSession(t, s, c, &csrf)
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Created after new cutoff", "scheduledDate": "2030-12-02", "startTime": "00:30", "endTime": "01:00"}, c, csrf, uuid.NewString()), 201)
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Ho_Chi_Minh", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	for i := 0; i < 2; i++ {
		day := calendar(t, s, c, "2030-12-01", "2030-12-02")["days"].([]any)[0].(map[string]any)
		if day["planned"] != float64(2) {
			t.Fatal("late contribution excluded by retroactive cutoff", day)
		}
	}
}

func TestLazyOccurrenceCanEnterExtendedFinalizedDay(t *testing.T) {
	s, pool := testServer(t)
	now := time.Date(2030, 11, 30, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "lazy-extension@example.com")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Tokyo", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Lazy", "scheduledDate": "2030-12-01", "startTime": "01:30", "endTime": "02:00"}, "cadence": "daily"}, c, csrf, uuid.NewString()), 201)
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Ho_Chi_Minh", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	// Simulate an accepted Tokyo day without materializing its next-day slot.
	_, err := pool.Exec(context.Background(), `INSERT INTO daily_snapshots(user_id,date,timezone,planned,completed,finalized_at) SELECT id,'2030-12-04','Asia/Tokyo',0,0,'2030-12-04T15:00:00Z' FROM users WHERE email='lazy-extension@example.com'`)
	if err != nil {
		t.Fatal(err)
	}
	now = time.Date(2030, 12, 6, 12, 0, 0, 0, time.UTC)
	renewTestSession(t, s, c, &csrf)
	day := calendar(t, s, c, "2030-12-04", "2030-12-05")["days"].([]any)[0].(map[string]any)
	if day["planned"] != float64(1) {
		t.Fatal("lazy slot suppressed by old snapshot", day)
	}
}
