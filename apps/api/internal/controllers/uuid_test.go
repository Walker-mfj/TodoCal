package controllers

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Every accepted spelling must behave like the canonical resource ID, including
// ownership checks. In particular, PostgreSQL does not accept UUID URNs.
func TestUUIDSpellings(t *testing.T) {
	forms := map[string]func(string) string{
		"urn":       func(id string) string { return "urn:uuid:" + id },
		"braces":    func(id string) string { return "{" + id + "}" },
		"compact":   func(id string) string { return strings.ReplaceAll(id, "-", "") },
		"uppercase": strings.ToUpper,
	}
	for name, form := range forms {
		t.Run(name, func(t *testing.T) {
			s, _ := testServer(t)
			s.now = func() time.Time { return atDate("2030-10-19") }
			c, csrf := register(t, s, "uuid-owner@example.com")
			other, otherCSRF := register(t, s, "uuid-other@example.com")
			write := func(method, path string, body any, status int) map[string]any {
				t.Helper()
				return object(t, command(s, method, path, body, c, csrf, uuid.NewString()), status)
			}
			group := write("POST", "/api/v1/groups", map[string]any{"name": "Work", "color": "#2563eb"}, 201)
			gid := group["id"].(string)
			task := write("POST", "/api/v1/tasks", map[string]any{"title": "Read"}, 201)
			id := task["id"].(string)
			t.Run("task-path", func(t *testing.T) {
				got := object(t, req(s, "GET", "/api/v1/tasks/"+form(id), nil, c, ""), 200)
				if got["id"] != id {
					t.Fatal(got)
				}
			})
			t.Run("group-payload", func(t *testing.T) {
				got := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Grouped", "groupId": form(gid)}, c, csrf, uuid.NewString()), 201)
				if got["groupId"] != gid {
					t.Fatal(got)
				}
			})
			t.Run("group-path", func(t *testing.T) {
				object(t, command(s, "PATCH", "/api/v1/groups/"+form(gid), map[string]any{"expectedRevision": 1, "name": "Updated"}, c, csrf, uuid.NewString()), 200)
			})
			for _, filter := range []string{"cursor", "groupId"} {
				t.Run(filter, func(t *testing.T) {
					value := id
					if filter == "groupId" {
						value = gid
					}
					canonical := req(s, "GET", "/api/v1/tasks?"+filter+"="+value, nil, c, "")
					alias := req(s, "GET", "/api/v1/tasks?"+filter+"="+url.QueryEscape(form(value)), nil, c, "")
					object(t, alias, 200)
					if canonical.Body.String() != alias.Body.String() {
						t.Fatal("alias changed list results")
					}
				})
			}
			t.Run("ownership", func(t *testing.T) {
				object(t, req(s, "GET", "/api/v1/tasks/"+form(id), nil, other, ""), 404)
				object(t, command(s, "PATCH", "/api/v1/groups/"+form(gid), map[string]any{"expectedRevision": 1}, other, otherCSRF, uuid.NewString()), 404)
				object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Foreign", "groupId": form(gid)}, other, otherCSRF, uuid.NewString()), 404)
			})
			t.Run("mutations", func(t *testing.T) {
				// Use the alias for each task mutation, not just reads.
				object(t, command(s, "PATCH", "/api/v1/tasks/"+form(id), map[string]any{"expectedRevision": 1, "title": "Edited"}, c, csrf, uuid.NewString()), 200)
				moved := object(t, command(s, "POST", "/api/v1/tasks/"+form(id)+"/schedule", map[string]any{"expectedRevision": 2, "scheduledDate": "2030-10-19", "startTime": nil, "endTime": nil}, c, csrf, uuid.NewString()), 200)
				undo := form(moved["undo"].(map[string]any)["id"].(string))
				object(t, command(s, "POST", "/api/v1/undo/"+undo, map[string]any{}, other, otherCSRF, uuid.NewString()), 404)
				object(t, command(s, "POST", "/api/v1/undo/"+undo, map[string]any{}, c, csrf, uuid.NewString()), 200)
				active := object(t, command(s, "POST", "/api/v1/focus", map[string]any{"kind": "focus", "taskId": form(id)}, c, csrf, uuid.NewString()), 201)["active"].(map[string]any)
				fid := form(active["id"].(string))
				object(t, command(s, "POST", "/api/v1/focus/"+fid+"/end", map[string]any{"expectedRevision": 1}, other, otherCSRF, uuid.NewString()), 404)
				object(t, command(s, "POST", "/api/v1/focus/"+fid+"/pause", map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
				object(t, command(s, "POST", "/api/v1/focus/"+fid+"/resume", map[string]any{"expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
				object(t, command(s, "POST", "/api/v1/focus/"+fid+"/end", map[string]any{"expectedRevision": 3}, c, csrf, uuid.NewString()), 200)
				object(t, command(s, "POST", "/api/v1/tasks/"+form(id)+"/completion", map[string]any{"expectedRevision": 4, "complete": true}, c, csrf, uuid.NewString()), 200)
				object(t, command(s, "DELETE", "/api/v1/tasks/"+form(id), map[string]any{"expectedRevision": 5}, c, csrf, uuid.NewString()), 200)
			})
			t.Run("series", func(t *testing.T) {
				sr := object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Repeat", "scheduledDate": "2030-10-19", "groupId": form(gid)}, "cadence": "daily", "intervalDays": 1}, c, csrf, uuid.NewString()), 201)
				sid := form(sr["id"].(string))
				object(t, req(s, "GET", "/api/v1/series/"+sid, nil, c, ""), 200)
				object(t, req(s, "GET", "/api/v1/series/"+sid, nil, other, ""), 404)
				object(t, command(s, "POST", "/api/v1/series/"+sid+"/stop", map[string]any{"expectedRevision": 1}, other, otherCSRF, uuid.NewString()), 404)
				object(t, command(s, "POST", "/api/v1/series/"+sid+"/stop", map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
				object(t, command(s, "DELETE", "/api/v1/groups/"+form(gid), map[string]any{"expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
			})
		})
	}
}

func TestMalformedUUIDsReturnClientErrors(t *testing.T) {
	s, _ := testServer(t)
	s.now = func() time.Time { return atDate("2030-10-19") }
	c, csrf := register(t, s, "malformed@example.com")
	for _, id := range []string{"not-a-uuid", "urn:uuid:not-a-uuid", "{broken}", strings.Repeat("a", 33)} {
		t.Run(id, func(t *testing.T) {
			for _, path := range []string{"/api/v1/tasks/", "/api/v1/series/"} {
				object(t, req(s, "GET", path+id, nil, c, ""), 404)
			}
			for _, tc := range []struct {
				method, path string
				body         any
			}{
				{"PATCH", "/api/v1/tasks/" + id, map[string]any{"expectedRevision": 1}},
				{"DELETE", "/api/v1/tasks/" + id, map[string]any{"expectedRevision": 1}},
				{"POST", "/api/v1/tasks/" + id + "/completion", map[string]any{"expectedRevision": 1, "complete": true}},
				{"POST", "/api/v1/tasks/" + id + "/schedule", map[string]any{"expectedRevision": 1, "scheduledDate": nil, "startTime": nil, "endTime": nil}},
				{"PATCH", "/api/v1/groups/" + id, map[string]any{"expectedRevision": 1}},
				{"DELETE", "/api/v1/groups/" + id, map[string]any{"expectedRevision": 1}},
				{"POST", "/api/v1/series/" + id + "/stop", map[string]any{"expectedRevision": 1}},
				{"POST", "/api/v1/focus/" + id + "/pause", map[string]any{"expectedRevision": 1}},
				{"POST", "/api/v1/undo/" + id, map[string]any{}},
				{"POST", "/api/v1/tasks", map[string]any{"title": "Invalid group", "groupId": id}},
				{"POST", "/api/v1/focus", map[string]any{"kind": "focus", "taskId": id}},
				{"POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Invalid group", "groupId": id, "scheduledDate": "2030-10-19"}, "cadence": "daily", "intervalDays": 1}},
			} {
				object(t, command(s, tc.method, tc.path, tc.body, c, csrf, uuid.NewString()), 404)
			}
			for _, filter := range []string{"cursor", "groupId"} {
				object(t, req(s, "GET", "/api/v1/tasks?"+filter+"="+url.QueryEscape(id), nil, c, ""), 422)
			}
		})
	}
}
