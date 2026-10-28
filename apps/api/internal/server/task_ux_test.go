package server

import (
	"github.com/google/uuid"
	"testing"
	"time"
)

func TestHistoricalAdjustmentDeleteRestoreAndCompletionDate(t *testing.T) {
	s, _ := testServer(t)
	now := atDate("2030-10-20")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "ux-history@example.com")
	call := func(method, path string, body any, status int) map[string]any {
		return object(t, command(s, method, "/api/v1"+path, body, c, csrf, uuid.NewString()), status)
	}
	day := func(date string) map[string]any {
		return object(t, req(s, "GET", "/api/v1/reports/days/"+date, nil, c, ""), 200)
	}
	a := call("POST", "/tasks", map[string]any{"title": "Past", "scheduledDate": "2030-10-18"}, 201)
	path := "/tasks/" + a["id"].(string)
	call("PATCH", path, map[string]any{"title": "Corrected", "expectedRevision": 1}, 200)
	call("POST", path+"/completion", map[string]any{"complete": true, "expectedRevision": 2, "completedAt": "2030-10-19T10:00:00Z"}, 200)
	d := day("2030-10-18")
	if d["planned"] != float64(1) || d["completed"] != float64(1) || d["completedTasks"] != float64(0) || day("2030-10-19")["completedTasks"] != float64(1) {
		t.Fatal(d)
	}
	if d["entries"].([]any)[0].(map[string]any)["task"].(map[string]any)["title"] != "Corrected" {
		t.Fatal(d)
	}
	call("DELETE", path, map[string]any{"expectedRevision": 3}, 200)
	if day("2030-10-18")["planned"] != float64(0) || day("2030-10-19")["completedTasks"] != float64(0) {
		t.Fatal("delete retained analytics")
	}
	call("POST", path+"/restore", map[string]any{"expectedRevision": 3}, 409)
	restored := call("POST", path+"/restore", map[string]any{"expectedRevision": 4}, 200)
	if restored["revision"] != float64(5) || day("2030-10-18")["completed"] != float64(1) {
		t.Fatal(restored)
	}
	call("POST", path+"/completion", map[string]any{"complete": false, "expectedRevision": 5}, 200)
	if day("2030-10-18")["completed"] != float64(0) || day("2030-10-19")["completedTasks"] != float64(0) {
		t.Fatal("reopen retained completion")
	}
}

func TestTaskFocusDurationOverGoalAndHistory(t *testing.T) {
	s, _ := testServer(t)
	now := atDate("2030-10-20")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "ux-focus@example.com")
	call := func(method, path string, body any, status int) map[string]any {
		return object(t, command(s, method, "/api/v1"+path, body, c, csrf, uuid.NewString()), status)
	}
	a := call("POST", "/tasks", map[string]any{"title": "Future focus", "scheduledDate": "2030-10-22", "focusMinutes": 10, "estimatedPomodoros": 2}, 201)
	for i := 0; i < 3; i++ {
		active := call("POST", "/focus", map[string]any{"kind": "focus", "taskId": a["id"]}, 201)["active"].(map[string]any)
		if active["targetSeconds"] != float64(600) {
			t.Fatal(active)
		}
		call("POST", "/focus", map[string]any{"kind": "focus"}, 409)
		now = now.Add(10 * time.Minute)
		focusActive(t, s, c)
	}
	path := "/api/v1/tasks/" + a["id"].(string)
	current := object(t, req(s, "GET", path, nil, c, ""), 200)
	if current["status"] != "incomplete" || current["scheduledDate"] != "2030-10-22" || current["estimatedPomodoros"] != float64(2) || current["focusProgress"] != float64(3) {
		t.Fatal(current)
	}
	history := object(t, req(s, "GET", path+"/focus", nil, c, ""), 200)
	if len(history["sessions"].([]any)) != 3 || history["actualFocusSeconds"] != float64(1800) {
		t.Fatal(history)
	}
	call("PATCH", "/tasks/"+a["id"].(string), map[string]any{"focusMinutes": 40, "expectedRevision": 1}, 200)
	current = object(t, req(s, "GET", path, nil, c, ""), 200)
	if current["focusProgress"] != float64(3) {
		t.Fatal("changing duration rewrote progress", current)
	}
	b := call("POST", "/tasks", map[string]any{"title": "No plan"}, 201)
	call("PATCH", "/settings", map[string]any{"focusMinutes": 15, "expectedRevision": 1}, 200)
	active := call("POST", "/focus", map[string]any{"kind": "focus", "taskId": b["id"]}, 201)["active"].(map[string]any)
	if active["targetSeconds"] != float64(900) {
		t.Fatal(active)
	}
	call("POST", "/focus/"+active["id"].(string)+"/pause", map[string]any{"expectedRevision": 1}, 200)
	call("POST", "/focus", map[string]any{"kind": "focus", "taskId": a["id"]}, 409)
}

func TestRecurringStopUndoAndOccurrenceRestore(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "ux-repeat@example.com")
	sr := series(t, s, c, csrf, "daily", 1, "2030-10-22")
	before := calendar(t, s, c, "2030-10-19", "2030-10-23")["tasks"].([]any)
	call := func(method, path string, body any, status int) map[string]any {
		return object(t, command(s, method, "/api/v1"+path, body, c, csrf, uuid.NewString()), status)
	}
	first := before[0].(map[string]any)
	path := "/tasks/" + first["id"].(string)
	call("DELETE", path, map[string]any{"expectedRevision": 1}, 200)
	call("POST", path+"/restore", map[string]any{"expectedRevision": 2}, 200)
	stopped := call("POST", "/series/"+sr["id"].(string)+"/stop", map[string]any{"expectedRevision": 1}, 200)
	if len(calendar(t, s, c, "2030-10-19", "2030-10-23")["tasks"].([]any)) != 1 {
		t.Fatal("stop did not retain today only")
	}
	call("POST", "/series/"+sr["id"].(string)+"/restore", map[string]any{"expectedRevision": stopped["revision"]}, 200)
	after := calendar(t, s, c, "2030-10-19", "2030-10-23")["tasks"].([]any)
	if len(after) != 4 {
		t.Fatal(after)
	}
	for i := range before {
		if before[i].(map[string]any)["id"] != after[i].(map[string]any)["id"] {
			t.Fatal("restore regenerated occurrence")
		}
	}
}

func TestCreateHistoricalSeriesAddsToFinalizedDays(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-20") }
	c, csrf := register(t, s, "past-series@example.com")
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Existing", "scheduledDate": "2030-10-18"}, c, csrf, uuid.NewString()), 201)
	object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Past repeating", "scheduledDate": "2030-10-18", "focusMinutes": 40}, "cadence": "daily", "endDate": "2030-10-20"}, c, csrf, uuid.NewString()), 201)
	days := calendar(t, s, c, "2030-10-18", "2030-10-21")["days"].([]any)
	for i, day := range days {
		d := day.(map[string]any)
		want := float64(1)
		if i == 0 {
			want = 2
		}
		if d["planned"] != want {
			t.Fatal(d)
		}
	}
}
