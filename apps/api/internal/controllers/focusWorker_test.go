package controllers

import (
	"context"
	"focuscalendar/internal/workers"
	"github.com/google/uuid"
	"testing"
	"time"
)

func TestWorkerSettlesFocusWithoutClientRead(t *testing.T) {
	s, p := testServer(t)
	now := time.Date(2030, 10, 19, 23, 55, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "worker-focus@example.com")
	active := object(t, command(s, "POST", "/api/v1/focus", map[string]any{"kind": "focus", "durationMinutes": 10}, c, csrf, uuid.NewString()), 201)["active"].(map[string]any)
	logicalEnd := now.Add(10 * time.Minute)
	now = now.Add(3 * time.Hour)
	for i := 0; i < 2; i++ {
		if _, err := workers.Sweep(context.Background(), p, s.now); err != nil {
			t.Fatal(err)
		}
	}
	// Query persisted state directly: GET /focus would conceal a missing worker settlement.
	var status string
	var ended time.Time
	var pom, accum, revision int64
	err := p.QueryRow(context.Background(), "SELECT status,ended_at,pomodoros,accumulated_us,revision FROM focus_sessions WHERE id=$1", active["id"]).Scan(&status, &ended, &pom, &accum, &revision)
	if err != nil {
		t.Fatal(err)
	}
	if status != "completed" || !ended.Equal(logicalEnd) || pom != 1 || accum != 600000000 || revision != 2 {
		t.Fatalf("persisted completion: %s %s pom=%d accum=%d rev=%d", status, ended, pom, accum, revision)
	}
	var intervalEnd time.Time
	if err = p.QueryRow(context.Background(), "SELECT ended_at FROM focus_intervals WHERE session_id=$1", active["id"]).Scan(&intervalEnd); err != nil {
		t.Fatal(err)
	}
	if !intervalEnd.Equal(logicalEnd) {
		t.Fatalf("interval end %s", intervalEnd)
	}
}

func TestWorkerLeavesPausedFocusUntouched(t *testing.T) {
	s, p := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "worker-pause@example.com")
	a := object(t, command(s, "POST", "/api/v1/focus", map[string]any{"kind": "focus", "durationMinutes": 1}, c, csrf, uuid.NewString()), 201)["active"].(map[string]any)
	now = now.Add(20 * time.Second)
	object(t, command(s, "POST", "/api/v1/focus/"+a["id"].(string)+"/pause", map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	now = now.Add(time.Hour)
	if _, err := workers.Sweep(context.Background(), p, s.now); err != nil {
		t.Fatal(err)
	}
	var status string
	var accum, pom int64
	if err := p.QueryRow(context.Background(), "SELECT status,accumulated_us,pomodoros FROM focus_sessions WHERE id=$1", a["id"]).Scan(&status, &accum, &pom); err != nil {
		t.Fatal(err)
	}
	if status != "paused" || accum != 20000000 || pom != 0 {
		t.Fatalf("paused state changed %s %d %d", status, accum, pom)
	}
}

func TestWorkerMaterializesReminderHorizonWithoutCalendarRead(t *testing.T) {
	s, pool := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	cookie, csrf := register(t, s, "worker-horizon@example.com")
	created := series(t, s, cookie, csrf, "daily", 1, nil)
	for i := 0; i < 2; i++ {
		if _, err := workers.Sweep(context.Background(), pool, s.now); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM tasks WHERE series_id=$1 AND original_occurrence_date IN ('2030-10-20','2030-10-21')", created["id"]).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("reminder horizon materialized %d tasks; want 2", count)
	}
}

func TestWorkerMaterializesEarlyRecurringDeadline(t *testing.T) {
	s, pool := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	cookie, csrf := register(t, s, "worker-deadline@example.com")
	object(t, command(s, "PUT", "/api/v1/notifications/preferences", map[string]any{"expectedRevision": 1, "deadline": true, "leadMinutes": 5}, cookie, csrf, uuid.NewString()), 200)
	created := object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Early deadline", "scheduledDate": "2030-10-29", "deadline": "2030-10-19T13:00:00Z"}, "cadence": "daily"}, cookie, csrf, uuid.NewString()), 201)
	s.now = func() time.Time { return atDate("2030-10-21") }
	// A delayed run still materializes yesterday's due deadline even though
	// its scheduled occurrence is nine days away.
	if _, err := workers.Sweep(context.Background(), pool, s.now); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM tasks WHERE series_id=$1 AND original_occurrence_date='2030-10-30'", created["id"]).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("recurring deadline outside calendar horizon was not materialized")
	}
}
