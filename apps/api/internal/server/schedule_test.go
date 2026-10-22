package server

import (
	"context"
	"github.com/google/uuid"
	"testing"
	"time"
)

func TestScheduleUndoPreservesTaskAndDailyPlans(t *testing.T) {
	s, _ := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "schedule@example.com")
	task := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Read", "scheduledDate": "2030-10-19", "startTime": "09:07", "endTime": "10:07", "deadline": "2030-10-25T00:00:00Z"}, c, csrf, uuid.NewString()), 201)
	id := task["id"].(string)
	path := "/api/v1/tasks/" + id + "/schedule"
	key := uuid.NewString()
	input := map[string]any{"scheduledDate": "2030-10-20", "startTime": "10:15", "endTime": "11:15", "expectedRevision": 1}
	moved := object(t, command(s, "POST", path, input, c, csrf, key), 200)
	after := moved["task"].(map[string]any)
	if after["deadline"] != task["deadline"] || after["status"] != "incomplete" || after["revision"] != float64(2) {
		t.Fatal(after)
	}
	replay := object(t, command(s, "POST", path, input, c, csrf, key), 200)
	if replay["undo"].(map[string]any)["id"] != moved["undo"].(map[string]any)["id"] {
		t.Fatal("retry issued another undo")
	}
	days := calendar(t, s, c, "2030-10-19", "2030-10-21")["days"].([]any)
	if days[0].(map[string]any)["planned"] != float64(0) || days[1].(map[string]any)["planned"] != float64(1) {
		t.Fatal(days)
	}
	undo := moved["undo"].(map[string]any)["id"].(string)
	now = now.Add(9 * time.Second)
	restored := object(t, command(s, "POST", "/api/v1/undo/"+undo, map[string]any{}, c, csrf, uuid.NewString()), 200)
	if restored["scheduledDate"] != "2030-10-19" || restored["startTime"] != "09:07" || restored["endTime"] != "10:07" || restored["deadline"] != task["deadline"] {
		t.Fatal(restored)
	}
	days = calendar(t, s, c, "2030-10-19", "2030-10-21")["days"].([]any)
	if days[0].(map[string]any)["planned"] != float64(1) || days[1].(map[string]any)["planned"] != float64(0) {
		t.Fatal(days)
	}
	object(t, command(s, "POST", "/api/v1/undo/"+undo, map[string]any{}, c, csrf, uuid.NewString()), 409)
}
func TestScheduleUndoConflictsExpiryOwnershipAndValidation(t *testing.T) {
	s, _ := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "undo-owner@example.com")
	other, otherCSRF := register(t, s, "undo-other@example.com")
	task := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Unscheduled"}, c, csrf, uuid.NewString()), 201)
	id := task["id"].(string)
	path := "/api/v1/tasks/" + id + "/schedule"
	for _, input := range []map[string]any{
		{"scheduledDate": "2030-02-30", "startTime": nil, "endTime": nil, "expectedRevision": 1},
		{"scheduledDate": "not-a-date", "startTime": nil, "endTime": nil, "expectedRevision": 1},
		{"scheduledDate": "2030-10-19", "startTime": "23:45", "endTime": "00:15", "expectedRevision": 1},
		{"scheduledDate": "2030-10-18", "startTime": nil, "endTime": nil, "expectedRevision": 1},
		{"scheduledDate": "2030-10-19", "startTime": "09:00", "endTime": nil, "expectedRevision": 1},
		{"scheduledDate": "2030-10-19", "expectedRevision": 1},
	} {
		object(t, command(s, "POST", path, input, c, csrf, uuid.NewString()), 422)
	}
	input := map[string]any{"scheduledDate": "2030-10-19", "startTime": "09:00", "endTime": "09:30", "expectedRevision": 1}
	moved := object(t, command(s, "POST", path, input, c, csrf, uuid.NewString()), 200)
	undo := moved["undo"].(map[string]any)["id"].(string)
	object(t, command(s, "POST", "/api/v1/undo/"+undo, map[string]any{}, other, otherCSRF, uuid.NewString()), 404)
	object(t, command(s, "POST", path, input, c, csrf, uuid.NewString()), 409)
	now = now.Add(10 * time.Second)
	object(t, command(s, "POST", "/api/v1/undo/"+undo, map[string]any{}, c, csrf, uuid.NewString()), 409)
	input = map[string]any{"scheduledDate": "2030-10-19", "startTime": nil, "endTime": nil, "expectedRevision": 2}
	untimed := object(t, command(s, "POST", path, input, c, csrf, uuid.NewString()), 200)
	if untimed["task"].(map[string]any)["startTime"] != nil {
		t.Fatal(untimed)
	}
	object(t, command(s, "PATCH", "/api/v1/tasks/"+id, map[string]any{"title": "Changed on another device", "expectedRevision": 3}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/undo/"+untimed["undo"].(map[string]any)["id"].(string), map[string]any{}, c, csrf, uuid.NewString()), 409)
}
func TestScheduleTransactionRollsBackWhenUndoCannotBeStored(t *testing.T) {
	s, p := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "undo-rollback@example.com")
	task := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Read"}, c, csrf, uuid.NewString()), 201)
	id := task["id"].(string)
	_, err := p.Exec(context.Background(), `ALTER TABLE schedule_undos ADD CONSTRAINT reject_schedule_test CHECK (false) NOT VALID`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), `ALTER TABLE schedule_undos DROP CONSTRAINT reject_schedule_test`)
	})
	object(t, command(s, "POST", "/api/v1/tasks/"+id+"/schedule", map[string]any{"scheduledDate": "2030-10-19", "startTime": "09:00", "endTime": "09:30", "expectedRevision": 1}, c, csrf, uuid.NewString()), 500)
	current := object(t, req(s, "GET", "/api/v1/tasks/"+id, nil, c, ""), 200)
	if current["scheduledDate"] != nil || current["revision"] != float64(1) {
		t.Fatal("partial schedule committed", current)
	}
}
