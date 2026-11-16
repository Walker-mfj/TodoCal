package controllers

import (
	"context"
	"net/http"
	"testing"
	"time"

	"focuscalendar/internal/services"
	"github.com/jackc/pgx/v5"

	"github.com/google/uuid"
)

func atDate(day string) time.Time {
	v, _ := time.Parse("2006-01-02", day)
	return v.Add(12 * time.Hour)
}

func calendar(t *testing.T, s *Server, c *http.Cookie, from, to string) map[string]any {
	t.Helper()
	return object(t, req(s, "GET", "/api/v1/calendar?from="+from+"&to="+to, nil, c, ""), 200)
}

func series(t *testing.T, s *Server, c *http.Cookie, csrf, cadence string, interval int, end any) map[string]any {
	t.Helper()
	return object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Practice", "scheduledDate": "2030-10-19"}, "cadence": cadence, "intervalDays": interval, "endDate": end}, c, csrf, uuid.NewString()), 201)
}

func TestDailyHistoryCarryoverAndProgress(t *testing.T) {
	s, _ := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "history@example.com")
	empty := calendar(t, s, c, "2030-10-19", "2030-10-20")["days"].([]any)[0].(map[string]any)
	if empty["planned"] != float64(0) || empty["percentage"] != nil {
		t.Fatal("empty day must have no percentage", empty)
	}
	var moving map[string]any
	for i := 0; i < 5; i++ {
		task := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Read", "scheduledDate": "2030-10-19"}, c, csrf, uuid.NewString()), 201)
		if i < 3 {
			object(t, command(s, "POST", "/api/v1/tasks/"+task["id"].(string)+"/completion", map[string]any{"complete": true, "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
		} else {
			moving = task
		}
	}
	days := calendar(t, s, c, "2030-10-19", "2030-10-21")["days"].([]any)
	if days[0].(map[string]any)["percentage"] != float64(60) || days[1].(map[string]any)["percentage"] != nil {
		t.Fatal(days)
	}
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Added", "scheduledDate": "2030-10-19"}, c, csrf, uuid.NewString()), 201)
	if calendar(t, s, c, "2030-10-19", "2030-10-20")["days"].([]any)[0].(map[string]any)["percentage"] != float64(50) {
		t.Fatal("wrong weighted progress")
	}
	now = atDate("2030-10-20")
	renewTestSession(t, s, c, &csrf)
	moved := object(t, command(s, "PATCH", "/api/v1/tasks/"+moving["id"].(string), map[string]any{"scheduledDate": "2030-10-20", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/tasks/"+moved["id"].(string)+"/completion", map[string]any{"complete": true, "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	days = calendar(t, s, c, "2030-10-19", "2030-10-21")["days"].([]any)
	if days[0].(map[string]any)["percentage"] != float64(60) || days[0].(map[string]any)["finalized"] != true || days[1].(map[string]any)["percentage"] != float64(100) {
		t.Fatal("explicit move did not correct history", days)
	}
	object(t, command(s, "DELETE", "/api/v1/tasks/"+moved["id"].(string), map[string]any{"expectedRevision": 3}, c, csrf, uuid.NewString()), 200)
	if calendar(t, s, c, "2030-10-19", "2030-10-20")["days"].([]any)[0].(map[string]any)["planned"] != float64(5) {
		t.Fatal("deletion rewrote history")
	}
}

func TestDelayedCatchupAndTimezoneSnapshotProtection(t *testing.T) {
	s, _ := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "catchup@example.com")
	series(t, s, c, csrf, "daily", 1, "2030-10-25")
	now = atDate("2030-10-23")
	renewTestSession(t, s, c, &csrf)
	out := calendar(t, s, c, "2030-10-19", "2030-10-24")
	for _, day := range out["days"].([]any)[:4] {
		d := day.(map[string]any)
		if d["planned"] != float64(1) || d["finalized"] != true || d["percentage"] != float64(0) {
			t.Fatal("missed closed-browser plan", d)
		}
	}
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Etc/GMT+12", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	// 00:30 UTC on the 23rd becomes the already-finalized 22nd in UTC-12.
	now = time.Date(2030, 10, 23, 0, 30, 0, 0, time.UTC)
	renewTestSession(t, s, c, &csrf)
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Historical adjustment", "scheduledDate": "2030-10-22"}, c, csrf, uuid.NewString()), 201)
	if calendar(t, s, c, "2030-10-22", "2030-10-23")["days"].([]any)[0].(map[string]any)["planned"] != float64(2) {
		t.Fatal("timezone changed history")
	}
}

func TestTimezoneForwardPreservesExistingDayPlan(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return time.Date(2030, 10, 20, 10, 30, 0, 0, time.UTC) }
	c, csrf := register(t, s, "zone-forward@example.com")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Etc/GMT+12", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Must survive", "scheduledDate": "2030-10-19"}, c, csrf, uuid.NewString()), 201)
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Pacific/Kiritimati", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	day := calendar(t, s, c, "2030-10-19", "2030-10-20")["days"].([]any)[0].(map[string]any)
	if day["planned"] != float64(1) || day["finalized"] != true {
		t.Fatal("timezone change erased the day plan", day)
	}
}

func TestCatchupAcrossSeveralBatchesAndStopPreservesHistory(t *testing.T) {
	s, p := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "batches@example.com")
	sr := series(t, s, c, csrf, "daily", 1, nil)
	now = atDate("2031-01-27") // 100 elapsed days
	var user string
	if e := p.QueryRow(context.Background(), "SELECT user_id FROM recurrence_series WHERE id=$1", sr["id"]).Scan(&user); e != nil {
		t.Fatal(e)
	}
	if e := services.WithTx(context.Background(), p, user, s.now, func(pgx.Tx, string, time.Time) error { return nil }); e != nil {
		t.Fatal(e)
	}
	var snapshots, entries int
	if e := p.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM daily_snapshots),(SELECT count(*) FROM daily_plan_entries)`).Scan(&snapshots, &entries); e != nil {
		t.Fatal(e)
	}
	if snapshots != 100 || entries != 100 {
		t.Fatal("catch-up lost a batch", snapshots, entries)
	}
	login := req(s, "POST", "/api/v1/auth/login", map[string]any{"email": "batches@example.com", "password": "correct horse battery"}, nil, "")
	body := object(t, login, 200)
	c = login.Result().Cookies()[0]
	csrf = body["csrfToken"].(string)
	today := calendar(t, s, c, "2031-01-27", "2031-01-29")["tasks"].([]any)[0].(map[string]any)
	object(t, command(s, "POST", "/api/v1/tasks/"+today["id"].(string)+"/completion", map[string]any{"complete": true, "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/series/"+sr["id"].(string)+"/stop", map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	out := calendar(t, s, c, "2031-01-26", "2031-01-29")
	if out["days"].([]any)[0].(map[string]any)["planned"] != float64(1) || len(out["tasks"].([]any)) != 1 || out["tasks"].([]any)[0].(map[string]any)["status"] != "complete" {
		t.Fatal("stop changed history/today", out)
	}
}

func TestCalendarUsesOneClockForCatchupAndProjection(t *testing.T) {
	s, _ := testServer(t)
	before := time.Date(2030, 10, 19, 23, 59, 59, 0, time.UTC)
	s.now = func() time.Time { return before }
	c, csrf := register(t, s, "midnight-read@example.com")
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Still planned", "scheduledDate": "2030-10-19"}, c, csrf, uuid.NewString()), 201)
	calls := 0
	s.now = func() time.Time {
		calls++
		if calls <= 2 {
			return before
		}
		return before.Add(2 * time.Second)
	}
	day := calendar(t, s, c, "2030-10-19", "2030-10-20")["days"].([]any)[0].(map[string]any)
	if day["planned"] != float64(1) {
		t.Fatal("midnight between catch-up and projection erased the plan", day)
	}
}

func TestTimezoneChangeReevaluatesFutureDSTException(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-03-09") }
	c, csrf := register(t, s, "future-gap@example.com")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "America/New_York", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Early", "scheduledDate": "2030-03-09", "startTime": "02:30", "endTime": "03:30"}, "cadence": "daily", "endDate": "2030-03-10"}, c, csrf, uuid.NewString()), 201)
	calendar(t, s, c, "2030-03-09", "2030-03-11")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "UTC", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	out := calendar(t, s, c, "2030-03-09", "2030-03-11")
	if len(out["tasks"].([]any)) != 2 || len(out["warnings"].([]any)) != 0 {
		t.Fatal("valid future occurrence stayed cancelled", out)
	}
}
