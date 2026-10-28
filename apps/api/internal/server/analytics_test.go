package server

import (
	"github.com/google/uuid"
	"testing"
	"time"
)

func TestPeriodWeightedPlansDistinctEventsAndReopen(t *testing.T) {
	s, _ := testServer(t)
	now := atDate("2030-10-14")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "analytics@example.com")
	create := func(date any) map[string]any {
		return object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Work", "scheduledDate": date}, c, csrf, uuid.NewString()), 201)
	}
	complete := func(task map[string]any, status bool) map[string]any {
		return object(t, command(s, "POST", "/api/v1/tasks/"+task["id"].(string)+"/completion", map[string]any{"complete": status, "expectedRevision": task["revision"]}, c, csrf, uuid.NewString()), 200)
	}
	a := complete(create("2030-10-14"), true)
	now = atDate("2030-10-15")
	for i := 0; i < 9; i++ {
		create("2030-10-15")
	}
	report := func() map[string]any {
		return object(t, req(s, "GET", "/api/v1/reports/period?period=week&date=2030-10-15", nil, c, ""), 200)
	}
	r := report()
	m := r["metrics"].(map[string]any)
	if m["percentage"] != float64(10) || m["planned"] != float64(10) || m["completedTasks"] != float64(1) {
		t.Fatal(m)
	}
	// Explicitly moving a task corrects its scheduled-day contribution without duplicating completion.
	object(t, command(s, "PATCH", "/api/v1/tasks/"+a["id"].(string), map[string]any{"scheduledDate": "2030-10-15", "expectedRevision": a["revision"]}, c, csrf, uuid.NewString()), 200)
	m = report()["metrics"].(map[string]any)
	if m["completed"] != float64(1) || m["completedTasks"] != float64(1) {
		t.Fatal(m)
	}
	b := complete(create(nil), true)
	m = report()["metrics"].(map[string]any)
	if m["completedTasks"] != float64(2) || m["planned"] != float64(10) {
		t.Fatal(m)
	}
	complete(b, false)
	if report()["metrics"].(map[string]any)["completedTasks"] != float64(1) {
		t.Fatal("same-day reopen counted")
	}
	// Explicit reopening corrects the earlier completion.
	current := object(t, req(s, "GET", "/api/v1/tasks/"+a["id"].(string), nil, c, ""), 200)
	complete(current, false)
	if report()["metrics"].(map[string]any)["completedTasks"] != float64(0) {
		t.Fatal("reopened completion retained")
	}
	create("2030-10-16")
	if report()["metrics"].(map[string]any)["planned"] != float64(10) {
		t.Fatal("future plan counted")
	}
	other, _ := register(t, s, "analytics-other@example.com")
	empty := object(t, req(s, "GET", "/api/v1/reports/period?period=week&date=2030-10-15", nil, other, ""), 200)
	if empty["metrics"].(map[string]any)["planned"] != float64(0) || empty["metrics"].(map[string]any)["percentage"] != nil {
		t.Fatal(empty)
	}
}
func TestAnalyticsFocusMidnightPausesAndActiveReconciliation(t *testing.T) {
	s, _ := testServer(t)
	now := time.Date(2030, 10, 14, 23, 50, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "midnight-focus@example.com")
	a := object(t, command(s, "POST", "/api/v1/focus", map[string]any{"kind": "focus"}, c, csrf, uuid.NewString()), 201)["active"].(map[string]any)
	id := a["id"].(string)
	now = now.Add(5 * time.Minute)
	object(t, command(s, "POST", "/api/v1/focus/"+id+"/pause", map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	now = now.Add(10 * time.Minute)
	object(t, command(s, "POST", "/api/v1/focus/"+id+"/resume", map[string]any{"expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	now = now.Add(10 * time.Minute)
	day := func(date string) map[string]any {
		return object(t, req(s, "GET", "/api/v1/reports/days/"+date, nil, c, ""), 200)
	}
	if day("2030-10-14")["focusSeconds"] != float64(300) || day("2030-10-15")["focusSeconds"] != float64(600) {
		t.Fatal("incorrect midnight split")
	}
	now = now.Add(20 * time.Minute)
	d := day("2030-10-15")
	if d["focusSeconds"] != float64(1200) || d["pomodoros"] != float64(1) {
		t.Fatal(d)
	}
	r := object(t, req(s, "GET", "/api/v1/reports/period?period=week&date=2030-10-15", nil, c, ""), 200)
	if r["metrics"].(map[string]any)["focusSeconds"] != float64(1500) {
		t.Fatal(r)
	}
}

func TestPeriodComparisonUsesHistoricalTimeOfDay(t *testing.T) {
	s, _ := testServer(t)
	now := time.Date(2030, 10, 7, 10, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "compare-time@example.com")
	a := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Afternoon finish", "scheduledDate": "2030-10-07"}, c, csrf, uuid.NewString()), 201)
	now = now.Add(8 * time.Hour)
	object(t, command(s, "POST", "/api/v1/tasks/"+a["id"].(string)+"/completion", map[string]any{"complete": true, "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	now = time.Date(2030, 10, 14, 12, 0, 0, 0, time.UTC)
	login := req(s, "POST", "/api/v1/auth/login", map[string]string{"email": "compare-time@example.com", "password": "correct horse battery"}, nil, "")
	object(t, login, 200)
	c = login.Result().Cookies()[0]
	r := object(t, req(s, "GET", "/api/v1/reports/period?period=week&date=2030-10-14", nil, c, ""), 200)
	comparison := r["comparison"].(map[string]any)
	m := comparison["metrics"].(map[string]any)
	if comparison["through"] != "2030-10-07T12:00:00Z" || m["planned"] != float64(1) || m["completed"] != float64(0) || m["completedTasks"] != float64(0) {
		t.Fatal(comparison)
	}
}
func TestPeriodRecurringOccurrencesCountIndependently(t *testing.T) {
	s, _ := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "repeat-analytics@example.com")
	series(t, s, c, csrf, "daily", 1, "2030-10-20")
	for _, date := range []string{"2030-10-19", "2030-10-20"} {
		now = atDate(date)
		d := object(t, req(s, "GET", "/api/v1/reports/days/"+date, nil, c, ""), 200)
		a := d["entries"].([]any)[0].(map[string]any)["task"].(map[string]any)
		object(t, command(s, "POST", "/api/v1/tasks/"+a["id"].(string)+"/completion", map[string]any{"complete": true, "expectedRevision": a["revision"]}, c, csrf, uuid.NewString()), 200)
	}
	r := object(t, req(s, "GET", "/api/v1/reports/period?period=week&date=2030-10-20", nil, c, ""), 200)
	m := r["metrics"].(map[string]any)
	if m["completedTasks"] != float64(2) || m["planned"] != float64(2) || m["percentage"] != float64(100) {
		t.Fatal(m)
	}
}

func TestAnalyticsPomodoroAtExactMidnightBelongsToNewDay(t *testing.T) {
	s, _ := testServer(t)
	now := time.Date(2030, 10, 14, 23, 35, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "midnight-exact@example.com")
	object(t, command(s, "POST", "/api/v1/focus", map[string]any{"kind": "focus"}, c, csrf, uuid.NewString()), 201)
	now = now.Add(25 * time.Minute)
	d := object(t, req(s, "GET", "/api/v1/reports/days/2030-10-15", nil, c, ""), 200)
	if d["pomodoros"] != float64(1) || d["focusSeconds"] != float64(0) {
		t.Fatal(d)
	}
	r := object(t, req(s, "GET", "/api/v1/reports/period?period=week&date=2030-10-15", nil, c, ""), 200)
	if r["metrics"].(map[string]any)["pomodoros"] != float64(1) {
		t.Fatal(r)
	}
}

func TestAnalyticsTimezoneChangeDoesNotDoubleCountFocus(t *testing.T) {
	s, _ := testServer(t)
	now := time.Date(2030, 10, 14, 23, 50, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "focus-zone@example.com")
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Keep historical plan", "scheduledDate": "2030-10-14"}, c, csrf, uuid.NewString()), 201)
	object(t, command(s, "POST", "/api/v1/focus", map[string]any{"kind": "focus"}, c, csrf, uuid.NewString()), 201)
	now = now.Add(25 * time.Minute)
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Tokyo", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	r := object(t, req(s, "GET", "/api/v1/reports/period?period=week&date=2030-10-15", nil, c, ""), 200)
	if r["metrics"].(map[string]any)["focusSeconds"] != float64(1500) {
		t.Fatal(r["metrics"])
	}
	d := object(t, req(s, "GET", "/api/v1/reports/days/2030-10-14", nil, c, ""), 200)
	if d["timezone"] != "UTC" || d["focusTimezone"] != "Asia/Tokyo" || d["focusSeconds"] != float64(0) {
		t.Fatal(d)
	}
}

func TestReopenOnRevisitedFinalizedDateCorrectsCompletionHistory(t *testing.T) {
	for _, scheduled := range []bool{true, false} {
		t.Run(map[bool]string{true: "planned", false: "completion-only"}[scheduled], func(t *testing.T) {
			s, _ := testServer(t)
			now := time.Date(2030, 10, 19, 12, 0, 0, 0, time.UTC)
			s.now = func() time.Time { return now }
			c, csrf := register(t, s, "roundtrip@example.com")
			body := map[string]any{"title": "Preserve completion"}
			if scheduled {
				body["scheduledDate"] = "2030-10-19"
			}
			task := object(t, command(s, "POST", "/api/v1/tasks", body, c, csrf, uuid.NewString()), 201)
			path := "/api/v1/tasks/" + task["id"].(string) + "/completion"
			object(t, command(s, "POST", path, map[string]any{"complete": true, "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
			object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Pacific/Kiritimati", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
			object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "UTC", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
			now = now.Add(time.Second)
			object(t, command(s, "POST", path, map[string]any{"complete": false, "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
			day := object(t, req(s, "GET", "/api/v1/reports/days/2030-10-19", nil, c, ""), 200)
			if day["completedTasks"] != float64(0) {
				t.Fatalf("finalized completion lost: %+v", day)
			}
			if scheduled && day["completed"] != float64(0) {
				t.Fatal("snapshot changed", day)
			}
		})
	}
}
