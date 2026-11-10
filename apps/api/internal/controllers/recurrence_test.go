package controllers

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

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
	renewTestSession(t, s, c, &csrf)
	out = calendar(t, s, c, "2030-03-09", "2030-03-12")
	if out["days"].([]any)[1].(map[string]any)["planned"] != float64(0) {
		t.Fatal("gap counted as a missed plan")
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
	renewTestSession(t, s, a, &ac)
	renewTestSession(t, s, b, &bc)
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

func TestEditRecurringTaskScope(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "series-edit@example.com")
	sr := series(t, s, c, csrf, "daily", 1, "2030-10-25")
	initial := calendar(t, s, c, "2030-10-19", "2030-10-22")["tasks"].([]any)
	selected := initial[1].(map[string]any)
	path := "/api/v1/tasks/" + selected["id"].(string)
	object(t, command(s, "PATCH", path, map[string]any{"title": "Only one", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	// All-scope updates materialized occurrences and the lazy template atomically.
	object(t, command(s, "PATCH", path, map[string]any{"title": "All updated", "scope": "all", "expectedRevision": 2, "expectedSeriesRevision": sr["revision"], "scheduledDate": "2030-10-21", "startTime": "10:00", "endTime": "10:15"}, c, csrf, uuid.NewString()), 200)
	all := calendar(t, s, c, "2030-10-19", "2030-10-27")["tasks"].([]any)
	if len(all) != 7 {
		t.Fatalf("expected 7 shifted occurrences, got %d", len(all))
	}
	for _, item := range all {
		v := item.(map[string]any)
		if v["title"] != "All updated" || v["startTime"] != "10:00" {
			t.Fatal(v)
		}
	}
	if all[0].(map[string]any)["scheduledDate"] != "2030-10-20" || all[6].(map[string]any)["scheduledDate"] != "2030-10-26" {
		t.Fatal(all)
	}
	object(t, command(s, "PATCH", path, map[string]any{"title": "Stale", "scope": "all", "expectedRevision": 3, "expectedSeriesRevision": 1}, c, csrf, uuid.NewString()), 409)
	// A different account cannot edit the series through an occurrence.
	other, otherCSRF := register(t, s, "series-edit-other@example.com")
	object(t, command(s, "PATCH", path, map[string]any{"title": "No", "scope": "all", "expectedRevision": 3, "expectedSeriesRevision": 2}, other, otherCSRF, uuid.NewString()), 404)
}

func TestSeriesEditPreservesHistoryAndRollsBackInvalidShift(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "series-history-edit@example.com")
	sr := series(t, s, c, csrf, "daily", 1, "2030-10-22")
	calendar(t, s, c, "2030-10-19", "2030-10-23")
	s.now = func() time.Time { return atDate("2030-10-20") }
	renewTestSession(t, s, c, &csrf)
	out := calendar(t, s, c, "2030-10-19", "2030-10-23")
	live := out["tasks"].([]any)
	selected := live[1].(map[string]any)
	path := "/api/v1/tasks/" + selected["id"].(string)
	// An invalid time range must roll back every occurrence.
	object(t, command(s, "PATCH", path, map[string]any{"scope": "all", "expectedRevision": 1, "expectedSeriesRevision": 1, "startTime": "10:00", "endTime": "09:00", "title": "Must roll back"}, c, csrf, uuid.NewString()), 422)
	unchanged := object(t, req(s, "GET", path, nil, c, ""), 200)
	if unchanged["title"] != "Practice" || unchanged["revision"] != float64(1) {
		t.Fatal(unchanged)
	}
	object(t, command(s, "PATCH", path, map[string]any{"scope": "all", "expectedRevision": 1, "expectedSeriesRevision": 1, "title": "Current updated"}, c, csrf, uuid.NewString()), 200)
	out = calendar(t, s, c, "2030-10-19", "2030-10-23")
	for _, item := range out["tasks"].([]any) {
		if item.(map[string]any)["title"] != "Current updated" {
			t.Fatal(item)
		}
	}
	day := object(t, req(s, "GET", "/api/v1/reports/days/2030-10-19", nil, c, ""), 200)
	raw, _ := json.Marshal(day)
	if !strings.Contains(string(raw), "Practice") || strings.Contains(string(raw), "Current updated") {
		t.Fatal(day)
	}
	meta := object(t, req(s, "GET", "/api/v1/series/"+sr["id"].(string), nil, c, ""), 200)
	if meta["revision"] != float64(2) {
		t.Fatal(meta)
	}
}

func TestSeriesSchedulePatchPreservesOccurrenceDetails(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "series-schedule-details@example.com")
	object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Practice", "scheduledDate": "2030-10-19", "deadline": "2030-10-19T12:00:00Z"}, "cadence": "daily", "intervalDays": 1, "endDate": "2030-10-23"}, c, csrf, uuid.NewString()), 201)
	items := calendar(t, s, c, "2030-10-19", "2030-10-21")["tasks"].([]any)
	selected := items[0].(map[string]any)
	other := items[1].(map[string]any)
	object(t, command(s, "PATCH", "/api/v1/tasks/"+other["id"].(string), map[string]any{"title": "Custom occurrence", "description": "Keep notes", "deadline": "2030-10-22T13:00:00Z", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "PATCH", "/api/v1/tasks/"+selected["id"].(string), map[string]any{"scheduledDate": "2030-10-20", "startTime": "11:00", "endTime": "11:30", "scope": "all", "expectedRevision": 1, "expectedSeriesRevision": 1}, c, csrf, uuid.NewString()), 200)
	preserved := object(t, req(s, "GET", "/api/v1/tasks/"+other["id"].(string), nil, c, ""), 200)
	if preserved["title"] != "Custom occurrence" || preserved["description"] != "Keep notes" || preserved["scheduledDate"] != "2030-10-21" || preserved["startTime"] != "11:00" || preserved["deadline"] != "2030-10-22T13:00:00Z" {
		t.Fatal(preserved)
	}
	lazy := calendar(t, s, c, "2030-10-23", "2030-10-25")["tasks"].([]any)
	if len(lazy) != 2 || lazy[0].(map[string]any)["deadline"] != "2030-10-22T12:00:00Z" {
		t.Fatal(lazy)
	}
	for _, item := range lazy {
		v := item.(map[string]any)
		if v["title"] != "Practice" || v["startTime"] != "11:00" {
			t.Fatal(v)
		}
	}
}

func TestSeriesPartialPatchValidatesLazyTemplate(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "partial-series-template@example.com")
	series(t, s, c, csrf, "daily", 1, "2030-10-21")
	selected := calendar(t, s, c, "2030-10-19", "2030-10-20")["tasks"].([]any)[0].(map[string]any)
	path := "/api/v1/tasks/" + selected["id"].(string)
	object(t, command(s, "PATCH", path, map[string]any{"startTime": "09:00", "endTime": "10:00", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "PATCH", path, map[string]any{"startTime": "08:00", "scope": "all", "expectedRevision": 2, "expectedSeriesRevision": 1}, c, csrf, uuid.NewString()), 422)
	lazy := calendar(t, s, c, "2030-10-20", "2030-10-22")["tasks"].([]any)
	if len(lazy) != 2 || lazy[0].(map[string]any)["startTime"] != nil {
		t.Fatal(lazy)
	}
}
