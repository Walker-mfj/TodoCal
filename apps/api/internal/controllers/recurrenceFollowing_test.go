package controllers

import (
	"context"
	"github.com/google/uuid"
	"testing"
	"time"
)

func TestFollowingEditSplitsAtOriginalSlotAndPreservesEarlierTasks(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "following@example.com")
	sr := series(t, s, c, csrf, "daily", 1, "2030-10-25")
	items := calendar(t, s, c, "2030-10-19", "2030-10-26")["tasks"].([]any)
	selected := items[3].(map[string]any)
	body := map[string]any{"expectedRevision": 1, "scope": "following", "expectedSeriesRevision": sr["revision"], "title": "Tail"}
	key := uuid.NewString()
	result := object(t, command(s, "PATCH", "/api/v1/tasks/"+selected["id"].(string), body, c, csrf, key), 200)
	if result["seriesId"] == sr["id"] {
		t.Fatal("tail was not split")
	}
	replay := object(t, command(s, "PATCH", "/api/v1/tasks/"+selected["id"].(string), body, c, csrf, key), 200)
	if replay["seriesId"] != result["seriesId"] {
		t.Fatal("retry split twice")
	}
	after := calendar(t, s, c, "2030-10-19", "2030-10-26")["tasks"].([]any)
	if len(after) != 7 {
		t.Fatal(after)
	}
	for i, item := range after {
		task := item.(map[string]any)
		want := "Practice"
		if i >= 3 {
			want = "Tail"
		}
		if task["title"] != want || task["id"] != items[i].(map[string]any)["id"] {
			t.Fatal(task)
		}
	}
}

func TestFollowingDeleteAndAtomicRestore(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "delete-tail@example.com")
	sr := series(t, s, c, csrf, "daily", 1, nil)
	items := calendar(t, s, c, "2030-10-19", "2030-10-24")["tasks"].([]any)
	selected := items[3].(map[string]any)
	out := object(t, command(s, "DELETE", "/api/v1/tasks/"+selected["id"].(string), map[string]any{"expectedRevision": 1, "scope": "following", "expectedSeriesRevision": 1}, c, csrf, uuid.NewString()), 200)
	if len(calendar(t, s, c, "2030-10-19", "2030-11-19")["tasks"].([]any)) != 3 {
		t.Fatal("tail resurrected")
	}
	object(t, command(s, "POST", "/api/v1/series/"+sr["id"].(string)+"/restore", map[string]any{"expectedRevision": out["seriesRevision"]}, c, csrf, uuid.NewString()), 200)
	after := calendar(t, s, c, "2030-10-19", "2030-10-24")["tasks"].([]any)
	if len(after) != 5 || after[3].(map[string]any)["id"] != selected["id"] {
		t.Fatal(after)
	}
}

func TestFollowingCadenceAndCompletedProtection(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "cadence@example.com")
	series(t, s, c, csrf, "daily", 1, nil)
	items := calendar(t, s, c, "2030-10-19", "2030-10-26")["tasks"].([]any)
	selected := items[2].(map[string]any)
	completed := items[3].(map[string]any)
	object(t, command(s, "POST", "/api/v1/tasks/"+completed["id"].(string)+"/completion", map[string]any{"complete": true, "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "PATCH", "/api/v1/tasks/"+selected["id"].(string), map[string]any{"expectedRevision": 1, "expectedSeriesRevision": 1, "scope": "following", "title": "Weekly", "recurrence": map[string]any{"cadence": "weekly", "intervalDays": 7, "endDate": "2030-11-10"}}, c, csrf, uuid.NewString()), 200)
	tasks := calendar(t, s, c, "2030-10-19", "2030-11-11")["tasks"].([]any)
	if len(tasks) != 6 {
		t.Fatalf("unexpected slots: %v", tasks)
	}
	for _, v := range tasks {
		task := v.(map[string]any)
		if task["id"] == completed["id"] && (task["title"] != "Practice" || task["status"] != "complete") {
			t.Fatal("completed task rewritten", task)
		}
	}
}

func TestFollowingMovedCutoffPreservesLazyDatesAndDeletedSlots(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "moved-tail@example.com")
	series(t, s, c, csrf, "daily", 1, nil)
	items := calendar(t, s, c, "2030-10-19", "2030-10-24")["tasks"].([]any)
	selected := items[2].(map[string]any)
	deleted := items[3].(map[string]any)
	object(t, command(s, "DELETE", "/api/v1/tasks/"+deleted["id"].(string), map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "PATCH", "/api/v1/tasks/"+selected["id"].(string), map[string]any{"expectedRevision": 1, "scheduledDate": "2030-10-25"}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "PATCH", "/api/v1/tasks/"+selected["id"].(string), map[string]any{"expectedRevision": 2, "expectedSeriesRevision": 1, "scope": "following", "title": "Moved tail"}, c, csrf, uuid.NewString()), 200)
	tasks := calendar(t, s, c, "2030-10-19", "2030-10-28")["tasks"].([]any)
	if len(tasks) != 8 {
		t.Fatalf("lost or duplicated slots: %v", tasks)
	}
	for _, v := range tasks {
		task := v.(map[string]any)
		if task["originalOccurrenceDate"] == "2030-10-24" && task["scheduledDate"] != "2030-10-24" {
			t.Fatal("moved exception shifted lazy siblings", task)
		}
		if task["id"] == deleted["id"] {
			t.Fatal("deleted slot resurrected")
		}
	}
}

func TestFollowingDeleteConfirmationAndConflictingUndoAreAtomic(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "undo-tail@example.com")
	sr := series(t, s, c, csrf, "daily", 1, nil)
	items := calendar(t, s, c, "2030-10-19", "2030-10-23")["tasks"].([]any)
	selected := items[1].(map[string]any)
	completed := items[2].(map[string]any)
	object(t, command(s, "POST", "/api/v1/tasks/"+completed["id"].(string)+"/completion", map[string]any{"expectedRevision": 1, "complete": true}, c, csrf, uuid.NewString()), 200)
	body := map[string]any{"expectedRevision": 1, "scope": "following", "expectedSeriesRevision": 1}
	object(t, command(s, "DELETE", "/api/v1/tasks/"+selected["id"].(string), body, c, csrf, uuid.NewString()), 422)
	if len(calendar(t, s, c, "2030-10-19", "2030-10-23")["tasks"].([]any)) != 4 {
		t.Fatal("unconfirmed deletion partially committed")
	}
	body["confirmCompleted"] = true
	out := object(t, command(s, "DELETE", "/api/v1/tasks/"+selected["id"].(string), body, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/tasks/"+completed["id"].(string)+"/restore", map[string]any{"expectedRevision": 3}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/series/"+sr["id"].(string)+"/restore", map[string]any{"expectedRevision": out["seriesRevision"]}, c, csrf, uuid.NewString()), 409)
	if len(calendar(t, s, c, "2030-10-19", "2030-10-23")["tasks"].([]any)) != 2 {
		t.Fatal("conflicting undo partially restored")
	}
}

func TestFollowingReevaluatesPredictedInvalidTimes(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-03-09") }
	c, csrf := register(t, s, "tail-dst@example.com")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "America/New_York", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Early", "scheduledDate": "2030-03-09", "startTime": "02:30", "endTime": "03:30"}, "cadence": "daily", "endDate": "2030-03-11"}, c, csrf, uuid.NewString()), 201)
	out := calendar(t, s, c, "2030-03-09", "2030-03-12")
	selected := out["tasks"].([]any)[0].(map[string]any)
	if len(out["warnings"].([]any)) != 1 {
		t.Fatal("expected DST gap prediction")
	}
	object(t, command(s, "PATCH", "/api/v1/tasks/"+selected["id"].(string), map[string]any{"expectedRevision": 1, "expectedSeriesRevision": 1, "scope": "following", "startTime": "04:00", "endTime": "05:00"}, c, csrf, uuid.NewString()), 200)
	out = calendar(t, s, c, "2030-03-09", "2030-03-12")
	if len(out["tasks"].([]any)) != 3 || len(out["warnings"].([]any)) != 0 {
		t.Fatal("valid future slot remained suppressed", out)
	}
}

func TestFollowingRejectsMovingTailIntoPast(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "past-tail@example.com")
	series(t, s, c, csrf, "daily", 1, nil)
	items := calendar(t, s, c, "2030-10-19", "2030-10-22")["tasks"].([]any)
	selected := items[1].(map[string]any)
	object(t, command(s, "PATCH", "/api/v1/tasks/"+selected["id"].(string), map[string]any{"expectedRevision": 1, "expectedSeriesRevision": 1, "scope": "following", "scheduledDate": "2030-10-18"}, c, csrf, uuid.NewString()), 422)
}

func TestFollowingRuleRoundTripAndEndDateRestoreOriginalIdentities(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "roundtrip@example.com")
	series(t, s, c, csrf, "daily", 1, nil)
	items := calendar(t, s, c, "2030-10-19", "2030-10-27")["tasks"].([]any)
	selected := items[2].(map[string]any)
	deleted := items[4].(map[string]any)
	object(t, command(s, "DELETE", "/api/v1/tasks/"+deleted["id"].(string), map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	for _, rule := range []map[string]any{
		{"cadence": "weekly", "intervalDays": 7, "endDate": nil},
		{"cadence": "daily", "intervalDays": 1, "endDate": nil},
		{"cadence": "daily", "intervalDays": 1, "endDate": "2030-10-22"},
		{"cadence": "daily", "intervalDays": 1, "endDate": nil},
	} {
		selected = object(t, command(s, "PATCH", "/api/v1/tasks/"+selected["id"].(string), map[string]any{"expectedRevision": selected["revision"], "expectedSeriesRevision": 1, "scope": "following", "recurrence": rule}, c, csrf, uuid.NewString()), 200)
		after := calendar(t, s, c, "2030-10-19", "2030-10-27")["tasks"].([]any)
		if rule["endDate"] == nil && rule["cadence"] == "daily" {
			if len(after) != 7 {
				t.Fatalf("round trip lost slots: %v", after)
			}
			for _, item := range after {
				task := item.(map[string]any)
				for _, original := range items {
					old := original.(map[string]any)
					if task["originalOccurrenceDate"] == old["originalOccurrenceDate"] && task["id"] != old["id"] {
						t.Fatal("identity changed", task)
					}
				}
				if task["id"] == deleted["id"] {
					t.Fatal("user deletion resurrected")
				}
			}
		}
	}
}

func TestFollowingReparentJournalsProtectedTasks(t *testing.T) {
	s, p := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "audit-tail@example.com")
	sr := series(t, s, c, csrf, "daily", 1, nil)
	items := calendar(t, s, c, "2030-10-19", "2030-10-23")["tasks"].([]any)
	selected := items[0].(map[string]any)
	completed := items[1].(map[string]any)
	deleted := items[2].(map[string]any)
	object(t, command(s, "POST", "/api/v1/tasks/"+completed["id"].(string)+"/completion", map[string]any{"expectedRevision": 1, "complete": true}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "DELETE", "/api/v1/tasks/"+deleted["id"].(string), map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	// A finalized accepted snapshot must retain its original membership/revision.
	_, err := p.Exec(context.Background(), `INSERT INTO daily_snapshots(user_id,date,timezone,planned,completed,finalized_at) SELECT user_id,scheduled_date,'Asia/Tokyo',1,1,$2 FROM tasks WHERE id=$1`, completed["id"], s.now())
	if err != nil {
		t.Fatal(err)
	}
	_, err = p.Exec(context.Background(), `INSERT INTO daily_plan_entries(user_id,date,task_id,task_state) SELECT user_id,scheduled_date,id,jsonb_build_object('seriesId',series_id,'revision',revision,'title',title) FROM tasks WHERE id=$1`, completed["id"])
	if err != nil {
		t.Fatal(err)
	}
	result := object(t, command(s, "PATCH", "/api/v1/tasks/"+selected["id"].(string), map[string]any{"expectedRevision": 1, "expectedSeriesRevision": 1, "scope": "following", "title": "New"}, c, csrf, uuid.NewString()), 200)
	for _, task := range []map[string]any{completed, deleted} {
		var count int
		err := p.QueryRow(context.Background(), `SELECT count(*) FROM task_events WHERE task_id=$1 AND kind='series_reparented' AND before_state->>'seriesId'=$2 AND after_state->>'seriesId'=$3 AND (after_state->>'revision')::int=(before_state->>'revision')::int+1 AND before_state->>'title'=after_state->>'title'`, task["id"], sr["id"], result["seriesId"]).Scan(&count)
		if err != nil || count != 1 {
			t.Fatalf("missing reparent journal: %d %v", count, err)
		}
	}
	var unchanged bool
	err = p.QueryRow(context.Background(), `SELECT task_state->>'seriesId'=$2 AND (task_state->>'revision')::int=2 AND task_state->>'title'='Practice' FROM daily_plan_entries WHERE task_id=$1`, completed["id"], sr["id"]).Scan(&unchanged)
	if err != nil || !unchanged {
		t.Fatalf("historical snapshot changed: %v %v", unchanged, err)
	}
	restored := object(t, command(s, "POST", "/api/v1/tasks/"+deleted["id"].(string)+"/restore", map[string]any{"expectedRevision": 3}, c, csrf, uuid.NewString()), 200)
	if restored["revision"] != float64(4) || restored["seriesId"] != result["seriesId"] || restored["title"] != "Practice" {
		t.Fatal("deleted task recovery lost state", restored)
	}

}

func TestFollowingPatchPreservesSiblingOverrides(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "overrides-tail@example.com")
	series(t, s, c, csrf, "daily", 1, nil)
	items := calendar(t, s, c, "2030-10-19", "2030-10-23")["tasks"].([]any)
	selected := items[0].(map[string]any)
	sibling := items[1].(map[string]any)
	group := object(t, command(s, "POST", "/api/v1/groups", map[string]any{"name": "Private", "color": "#123456"}, c, csrf, uuid.NewString()), 201)
	override := map[string]any{"expectedRevision": 1, "title": "Custom title", "priority": "high", "groupId": group["id"], "deadline": "2030-10-20T15:00:00Z"}
	sibling = object(t, command(s, "PATCH", "/api/v1/tasks/"+sibling["id"].(string), override, c, csrf, uuid.NewString()), 200)
	selected = object(t, command(s, "PATCH", "/api/v1/tasks/"+selected["id"].(string), map[string]any{"expectedRevision": 1, "expectedSeriesRevision": 1, "scope": "following", "description": "Changed description"}, c, csrf, uuid.NewString()), 200)
	after := object(t, req(s, "GET", "/api/v1/tasks/"+sibling["id"].(string), nil, c, ""), 200)
	for _, field := range []string{"title", "priority", "groupId", "deadline"} {
		if after[field] != sibling[field] {
			t.Fatalf("overwrote %s: %v", field, after)
		}
	}
	object(t, command(s, "PATCH", "/api/v1/tasks/"+selected["id"].(string), map[string]any{"expectedRevision": selected["revision"], "expectedSeriesRevision": 1, "scope": "following", "title": "Renamed"}, c, csrf, uuid.NewString()), 200)
	after = object(t, req(s, "GET", "/api/v1/tasks/"+sibling["id"].(string), nil, c, ""), 200)
	if after["title"] != "Renamed" {
		t.Fatal(after)
	}
	for _, field := range []string{"priority", "groupId", "deadline"} {
		if after[field] != sibling[field] {
			t.Fatalf("overwrote %s: %v", field, after)
		}
	}
}

func TestFollowingRestoreUsesCurrentOffsetAndPreservesMovedExceptions(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "offset-restore@example.com")
	series(t, s, c, csrf, "daily", 1, nil)
	items := calendar(t, s, c, "2030-10-19", "2030-10-27")["tasks"].([]any)
	selected := items[2].(map[string]any)
	excluded := items[3].(map[string]any)
	moved := items[4].(map[string]any)
	object(t, command(s, "PATCH", "/api/v1/tasks/"+moved["id"].(string), map[string]any{"expectedRevision": 1, "scheduledDate": "2030-10-30"}, c, csrf, uuid.NewString()), 200)
	for i, cadence := range []string{"weekly", "daily", "weekly", "daily"} {
		interval := 1
		if cadence == "weekly" {
			interval = 7
		}
		body := map[string]any{"expectedRevision": selected["revision"], "expectedSeriesRevision": 1, "scope": "following", "recurrence": map[string]any{"cadence": cadence, "intervalDays": interval}}
		if i == 0 {
			body["scheduledDate"] = "2030-10-23"
		}
		selected = object(t, command(s, "PATCH", "/api/v1/tasks/"+selected["id"].(string), body, c, csrf, uuid.NewString()), 200)
		tasks := calendar(t, s, c, "2030-10-19", "2030-11-02")["tasks"].([]any)
		found, foundMoved := false, false
		for _, v := range tasks {
			task := v.(map[string]any)
			if task["id"] == excluded["id"] {
				found = true
				if task["scheduledDate"] != "2030-10-24" {
					t.Fatalf("restored at stale date: %v", task)
				}
			}
			if task["id"] == moved["id"] {
				foundMoved = true
				if task["scheduledDate"] != "2030-10-30" {
					t.Fatalf("moved override changed: %v", task)
				}
			}
		}
		if !foundMoved {
			t.Fatal("moved occurrence disappeared")
		}
		if found != (cadence == "daily") {
			t.Fatalf("rule-excluded slot visibility incorrect for %s: %v", cadence, found)
		}
	}
}
