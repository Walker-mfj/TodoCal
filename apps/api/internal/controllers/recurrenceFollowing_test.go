package controllers

import (
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
