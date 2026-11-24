package controllers

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestUndoDeleteRestoresAttributionBeforeOriginalMidnight(t *testing.T) {
	s, pool := testServer(t)
	now := time.Date(2030, 12, 1, 23, 0, 0, 123456789, time.UTC)
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "undo-forward@example.com")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "UTC", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	task := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Historical", "scheduledDate": "2030-12-01", "startTime": "22:00", "endTime": "22:30"}, c, csrf, uuid.NewString()), 201)
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Tokyo", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	path := "/api/v1/tasks/" + task["id"].(string)
	for i := 0; i < 2; i++ {
		current := object(t, req(s, "GET", path, nil, c, ""), 200)
		object(t, command(s, "DELETE", path, map[string]any{"expectedRevision": current["revision"]}, c, csrf, uuid.NewString()), 200)
		var entries int
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM daily_plan_entries WHERE task_id=$1`, task["id"]).Scan(&entries); err != nil {
			t.Fatal(err)
		}
		if entries != 0 {
			t.Fatal("delete retained the plan contribution")
		}
		now = now.Add(time.Second)
		restored := object(t, command(s, "POST", path+"/restore", map[string]any{"expectedRevision": current["revision"].(float64) + 1}, c, csrf, uuid.NewString()), 200)
		for _, field := range []string{"id", "scheduledStartAt", "scheduledEndAt"} {
			if restored[field] != task[field] {
				t.Fatalf("Undo changed %s", field)
			}
		}
		// Check the stored attribution before another request can reconcile it.
		var date, zone string
		if err := pool.QueryRow(context.Background(), `SELECT p.date::text,COALESCE(p.task_state->>'timezone',s.timezone) FROM daily_plan_entries p JOIN daily_snapshots s ON s.user_id=p.user_id AND s.date=p.date WHERE p.task_id=$1`, task["id"]).Scan(&date, &zone); err != nil {
			t.Fatal(err)
		}
		if date != "2030-12-01" || zone != "UTC" {
			t.Fatalf("wrong restored attribution: %s %s", date, zone)
		}
		out := calendar(t, s, c, "2030-12-01", "2030-12-03")
		days := out["days"].([]any)
		historical := days[0].(map[string]any)
		next := days[1].(map[string]any)
		if historical["planned"] != float64(1) || historical["timezone"] != "UTC" || next["planned"] != float64(0) || len(out["tasks"].([]any)) != 0 {
			t.Fatal("Undo leaked a live contribution", out)
		}
		saved := historical["entries"].([]any)[0].(map[string]any)["task"].(map[string]any)
		if saved["id"] != task["id"] || saved["startTime"] != "22:00" {
			t.Fatal("wrong historical task", saved)
		}
	}
}

func TestUndoLiveTaskDoesNotClaimExistingSnapshot(t *testing.T) {
	s, pool := testServer(t)
	now := time.Date(2030, 12, 1, 23, 0, 0, 123456789, time.UTC)
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "undo-live@example.com")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "UTC", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Saved", "scheduledDate": "2030-12-01"}, c, csrf, uuid.NewString()), 201)
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Tokyo", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "UTC", "expectedRevision": 3}, c, csrf, uuid.NewString()), 200)
	live := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "New live plan", "scheduledDate": "2030-12-01", "startTime": "23:30", "endTime": "23:45"}, c, csrf, uuid.NewString()), 201)
	path := "/api/v1/tasks/" + live["id"].(string)
	object(t, command(s, "DELETE", path, map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	now = now.Add(time.Second)
	object(t, command(s, "POST", path+"/restore", map[string]any{"expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	var count int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM daily_plan_entries WHERE task_id=$1`, live["id"]).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("Undo prematurely finalized an unattributed live task")
	}
	out := calendar(t, s, c, "2030-12-01", "2030-12-02")
	tasks := out["tasks"].([]any)
	if len(tasks) != 1 || tasks[0].(map[string]any)["id"] != live["id"] {
		t.Fatal("live task lost after Undo", out)
	}
}
