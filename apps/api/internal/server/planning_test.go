package server

import (
	"context"
	"focuscalendar/internal/planning"
	"github.com/google/uuid"
	"net/http"
	"testing"
	"time"
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
func TestRecurrenceCadenceAndInclusiveEnd(t *testing.T) {
	for _, tc := range []struct {
		cadence  string
		interval int
		end, to  string
		want     []string
	}{
		{"daily", 1, "2030-10-19", "2030-10-20", []string{"2030-10-19"}},
		{"daily", 1, "2030-10-25", "2030-10-26", []string{"2030-10-19", "2030-10-20", "2030-10-21", "2030-10-22", "2030-10-23", "2030-10-24", "2030-10-25"}},
		{"interval", 2, "2030-10-25", "2030-10-26", []string{"2030-10-19", "2030-10-21", "2030-10-23", "2030-10-25"}},
		{"weekly", 7, "2030-11-02", "2030-11-03", []string{"2030-10-19", "2030-10-26", "2030-11-02"}},
	} {
		t.Run(tc.cadence, func(t *testing.T) {
			s, _ := testServer(t)
			s.now = func() time.Time { return atDate("2030-10-19") }
			c, csrf := register(t, s, "repeat@example.com")
			series(t, s, c, csrf, tc.cadence, tc.interval, tc.end)
			out := calendar(t, s, c, "2030-10-19", tc.to)
			items := out["tasks"].([]any)
			if len(items) != len(tc.want) {
				t.Fatalf("want %d got %d", len(tc.want), len(items))
			}
			for i, item := range items {
				if item.(map[string]any)["scheduledDate"] != tc.want[i] {
					t.Fatal(items)
				}
			}
		})
	}
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
	moved := object(t, command(s, "PATCH", "/api/v1/tasks/"+moving["id"].(string), map[string]any{"scheduledDate": "2030-10-20", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/tasks/"+moved["id"].(string)+"/completion", map[string]any{"complete": true, "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	days = calendar(t, s, c, "2030-10-19", "2030-10-21")["days"].([]any)
	if days[0].(map[string]any)["percentage"] != float64(50) || days[0].(map[string]any)["finalized"] != true || days[1].(map[string]any)["percentage"] != float64(100) {
		t.Fatal("carryover rewrote history", days)
	}
	object(t, command(s, "DELETE", "/api/v1/tasks/"+moved["id"].(string), map[string]any{"expectedRevision": 3}, c, csrf, uuid.NewString()), 200)
	if calendar(t, s, c, "2030-10-19", "2030-10-20")["days"].([]any)[0].(map[string]any)["planned"] != float64(6) {
		t.Fatal("deletion rewrote history")
	}
}
func TestLazyRecurrenceExceptionsAndStop(t *testing.T) {
	s, p := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "exception@example.com")
	sr := series(t, s, c, csrf, "daily", 1, nil)
	out := calendar(t, s, c, "2030-10-19", "2030-10-22")
	items := out["tasks"].([]any)
	first := items[0].(map[string]any)
	second := items[1].(map[string]any)
	object(t, command(s, "DELETE", "/api/v1/tasks/"+first["id"].(string), map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "PATCH", "/api/v1/tasks/"+second["id"].(string), map[string]any{"scheduledDate": "2030-10-22", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	out = calendar(t, s, c, "2030-10-19", "2030-10-22")
	if len(out["tasks"].([]any)) != 1 {
		t.Fatal("exceptions regenerated", out)
	}
	object(t, command(s, "POST", "/api/v1/series/"+sr["id"].(string)+"/stop", map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	if len(calendar(t, s, c, "2030-10-19", "2030-11-19")["tasks"].([]any)) != 0 {
		t.Fatal("stopped series regenerated")
	}
	var count int
	if e := p.QueryRow(context.Background(), `SELECT count(*) FROM tasks`).Scan(&count); e != nil {
		t.Fatal(e)
	}
	if count > 4 {
		t.Fatal("unbounded generation")
	}
}
func TestDelayedCatchupAndTimezoneSnapshotProtection(t *testing.T) {
	s, _ := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "catchup@example.com")
	series(t, s, c, csrf, "daily", 1, "2030-10-25")
	now = atDate("2030-10-23")
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
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Cannot rewrite", "scheduledDate": "2030-10-22"}, c, csrf, uuid.NewString()), 422)
	if calendar(t, s, c, "2030-10-22", "2030-10-23")["days"].([]any)[0].(map[string]any)["planned"] != float64(1) {
		t.Fatal("timezone changed history")
	}
}

func TestRecurrenceValidationDeadlineAndIndependentCompletion(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "deadline@example.com")
	for _, body := range []map[string]any{
		{"task": map[string]any{"title": "No start"}, "cadence": "daily"},
		{"task": map[string]any{"title": "Invalid", "scheduledDate": "2030-10-19"}, "cadence": "interval", "intervalDays": 1},
		{"task": map[string]any{"title": "Invalid", "scheduledDate": "2030-10-19"}, "cadence": "interval", "intervalDays": 366},
		{"task": map[string]any{"title": "Invalid", "scheduledDate": "2030-10-19"}, "cadence": "daily", "endDate": "2030-10-18"},
	} {
		object(t, command(s, "POST", "/api/v1/series", body, c, csrf, uuid.NewString()), 422)
	}
	object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Deadline", "scheduledDate": "2030-10-19", "deadline": "2030-10-21T17:15:00Z"}, "cadence": "daily", "endDate": "2030-10-20"}, c, csrf, uuid.NewString()), 201)
	items := calendar(t, s, c, "2030-10-19", "2030-10-21")["tasks"].([]any)
	if items[1].(map[string]any)["deadline"] != "2030-10-22T17:15:00Z" {
		t.Fatal("deadline offset lost", items)
	}
	object(t, command(s, "POST", "/api/v1/tasks/"+items[0].(map[string]any)["id"].(string)+"/completion", map[string]any{"complete": true, "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	items = calendar(t, s, c, "2030-10-19", "2030-10-21")["tasks"].([]any)
	if items[0].(map[string]any)["status"] != "complete" || items[1].(map[string]any)["status"] != "incomplete" {
		t.Fatal("completion affected sibling occurrence")
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
func TestRecurrenceDSTGapIsReportedWithoutBlockingCatchup(t *testing.T) {
	s, _ := testServer(t)
	now := atDate("2030-03-09")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "dst@example.com")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "America/New_York", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Early", "scheduledDate": "2030-03-09", "startTime": "02:30", "endTime": "03:30"}, "cadence": "daily", "endDate": "2030-03-11"}, c, csrf, uuid.NewString()), 201)
	out := calendar(t, s, c, "2030-03-09", "2030-03-12")
	if len(out["tasks"].([]any)) != 2 || len(out["warnings"].([]any)) != 1 {
		t.Fatal("gap occurrence not handled", out)
	}
	now = atDate("2030-03-12")
	out = calendar(t, s, c, "2030-03-09", "2030-03-12")
	if out["days"].([]any)[1].(map[string]any)["planned"] != float64(0) {
		t.Fatal("gap counted as a missed plan")
	}
}

func TestWorkerAndAPIConcurrentlyFinalizeOnce(t *testing.T) {
	s, p := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "worker@example.com")
	series(t, s, c, csrf, "daily", 1, nil)
	now = atDate("2030-10-22")
	results := make(chan error, 1)
	go func() { _, e := planning.Sweep(context.Background(), p, s.now); results <- e }()
	out := calendar(t, s, c, "2030-10-19", "2030-10-23")
	if e := <-results; e != nil {
		t.Fatal(e)
	}
	var occurrences, snapshots int
	if e := p.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM tasks),(SELECT count(*) FROM daily_snapshots)`).Scan(&occurrences, &snapshots); e != nil {
		t.Fatal(e)
	}
	if occurrences != 4 || snapshots != 3 {
		t.Fatal("duplicate or missing catch-up", occurrences, snapshots, out)
	}
}
func TestCatchupAcrossSeveralBatchesAndStopPreservesHistory(t *testing.T) {
	s, p := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "batches@example.com")
	sr := series(t, s, c, csrf, "daily", 1, nil)
	now = atDate("2031-01-27") // 100 elapsed days
	if _, e := planning.Sweep(context.Background(), p, s.now); e != nil {
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
func TestSeriesOwnershipRangeAndGroupHistory(t *testing.T) {
	s, _ := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	a, ac := register(t, s, "owner@example.com")
	b, bc := register(t, s, "outsider@example.com")
	g := object(t, command(s, "POST", "/api/v1/groups", map[string]any{"name": "Original", "color": "#123456"}, a, ac, uuid.NewString()), 201)
	sr := object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Grouped", "scheduledDate": "2030-10-19", "groupId": g["id"]}, "cadence": "daily", "endDate": "2030-10-21"}, a, ac, uuid.NewString()), 201)
	object(t, command(s, "POST", "/api/v1/series/"+sr["id"].(string)+"/stop", map[string]any{"expectedRevision": 1}, b, bc, uuid.NewString()), 404)
	if len(calendar(t, s, b, "2030-10-19", "2030-10-22")["tasks"].([]any)) != 0 {
		t.Fatal("foreign calendar leaked")
	}
	object(t, req(s, "GET", "/api/v1/calendar?from=2030-10-19&to=2031-10-19", nil, a, ""), 422)
	now = atDate("2030-10-20")
	object(t, command(s, "DELETE", "/api/v1/groups/"+g["id"].(string), map[string]any{"expectedRevision": 1}, a, ac, uuid.NewString()), 200)
	out := calendar(t, s, a, "2030-10-19", "2030-10-22")
	old := out["days"].([]any)[0].(map[string]any)["entries"].([]any)[0].(map[string]any)
	if old["groupName"] != "Original" || old["groupColor"] != "#123456" {
		t.Fatal("group history changed", old)
	}
	for _, item := range out["tasks"].([]any) {
		if item.(map[string]any)["groupId"] != nil {
			t.Fatal("series retained deleted group")
		}
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

func TestWorkerBlockedAccountDoesNotStarveLaterAccounts(t *testing.T) {
	s, p := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	for _, email := range []string{"blocked@example.com", "later@example.com"} {
		c, csrf := register(t, s, email)
		object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Plan", "scheduledDate": "2030-10-19"}, c, csrf, uuid.NewString()), 201)
	}
	var first, last string
	if e := p.QueryRow(context.Background(), `SELECT min(id::text),max(id::text) FROM users`).Scan(&first, &last); e != nil {
		t.Fatal(e)
	}
	lock, e := p.Begin(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	defer lock.Rollback(context.Background())
	if _, e = lock.Exec(context.Background(), `SELECT user_id FROM settings WHERE user_id=$1 FOR UPDATE`, first); e != nil {
		t.Fatal(e)
	}
	now = atDate("2030-10-20")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _ = planning.Sweep(ctx, p, s.now)
	var settled bool
	if e = p.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date='2030-10-19')`, last).Scan(&settled); e != nil {
		t.Fatal(e)
	}
	if !settled {
		t.Fatal("a blocked first account starved the later account")
	}
}

func TestWorkerResumesAfterAnInterruptedSweep(t *testing.T) {
	s, p := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	for _, email := range []string{"resume-a@example.com", "resume-b@example.com"} {
		c, csrf := register(t, s, email)
		object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Plan", "scheduledDate": "2030-10-19"}, c, csrf, uuid.NewString()), 201)
	}
	var first, last string
	if e := p.QueryRow(context.Background(), `SELECT min(id::text),max(id::text) FROM users`).Scan(&first, &last); e != nil {
		t.Fatal(e)
	}
	now = atDate("2030-10-20")
	runner := &planning.Sweeper{}
	ctx, cancel := context.WithCancel(context.Background())
	_, _ = runner.Sweep(ctx, p, func() time.Time { cancel(); return now })
	if runner.Cursor != first {
		t.Fatal("interrupted cursor was lost", runner.Cursor)
	}
	if _, e := runner.Sweep(context.Background(), p, s.now); e != nil {
		t.Fatal(e)
	}
	var early, later bool
	if e := p.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1),EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$2)`, first, last).Scan(&early, &later); e != nil {
		t.Fatal(e)
	}
	if early || !later {
		t.Fatal("resumed sweep restarted its prefix", early, later)
	}
	if _, e := runner.Sweep(context.Background(), p, s.now); e != nil {
		t.Fatal(e)
	}
	if e := p.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1)`, first).Scan(&early); e != nil {
		t.Fatal(e)
	}
	if !early {
		t.Fatal("skipped account never retried after wrap")
	}
}

func TestReadSeriesOwnedAndCurrentRevision(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	a, csrf := register(t, s, "series-owner@example.com")
	b, _ := register(t, s, "series-other@example.com")
	sr := series(t, s, a, csrf, "weekly", 7, nil)
	path := "/api/v1/series/" + sr["id"].(string)
	out := object(t, req(s, "GET", path, nil, a, ""), 200)
	if out["cadence"] != "weekly" || out["revision"] != float64(1) {
		t.Fatal(out)
	}
	object(t, req(s, "GET", path, nil, b, ""), 404)
	object(t, req(s, "GET", path, nil, nil, ""), 401)
	object(t, command(s, "POST", path+"/stop", map[string]any{"expectedRevision": 1}, a, csrf, uuid.NewString()), 200)
	out = object(t, req(s, "GET", path, nil, a, ""), 200)
	if out["revision"] != float64(2) || out["stoppedAfter"] == nil {
		t.Fatal(out)
	}
}
