package controllers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
)

func command(s *Server, method, path string, body any, c *http.Cookie, csrf, key string) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	r := httptest.NewRequest(method, path, bytes.NewReader(b))
	r.Header.Set("Origin", "http://localhost:3000")
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-CSRF-Token", csrf)
	r.Header.Set("Idempotency-Key", key)
	r.AddCookie(c)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}
func object(t *testing.T, w *httptest.ResponseRecorder, status int) map[string]any {
	t.Helper()
	if w.Code != status {
		t.Fatalf("want %d got %d: %s", status, w.Code, w.Body)
	}
	var b map[string]any
	if e := json.Unmarshal(w.Body.Bytes(), &b); e != nil {
		t.Fatal(e)
	}
	return b
}
func TestTasksIdempotencyRevisionAndOptionalFocus(t *testing.T) {
	s, _ := testServer(t)
	c, csrf := register(t, s, "tasks@example.com")
	key := uuid.NewString()
	input := map[string]any{"title": "  Read a book  "}
	first := command(s, "POST", "/api/v1/tasks", input, c, csrf, key)
	task := object(t, first, 201)
	if task["title"] != "Read a book" || task["estimatedPomodoros"] != nil || task["scheduledDate"] != nil || task["priority"] != "medium" {
		t.Fatal(task)
	}
	second := command(s, "POST", "/api/v1/tasks", input, c, csrf, key)
	if second.Code != 201 || second.Body.String() != first.Body.String() {
		t.Fatal("retry did not replay original response")
	}
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Different"}, c, csrf, key), 409)
	id := task["id"].(string)
	done := object(t, command(s, "POST", "/api/v1/tasks/"+id+"/completion", map[string]any{"complete": true, "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	if done["status"] != "complete" || done["scheduledDate"] != nil {
		t.Fatal("unscheduled completion changed plan", done)
	}
	object(t, command(s, "PATCH", "/api/v1/tasks/"+id, map[string]any{"title": "Stale", "expectedRevision": 1}, c, csrf, uuid.NewString()), 409)
	changed := object(t, command(s, "PATCH", "/api/v1/tasks/"+id, map[string]any{"description": "Keep the title", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	if changed["title"] != "Read a book" || changed["status"] != "complete" {
		t.Fatal("partial patch lost data")
	}
	object(t, command(s, "DELETE", "/api/v1/tasks/"+id, map[string]any{"expectedRevision": 3}, c, csrf, uuid.NewString()), 200)
	object(t, req(s, "GET", "/api/v1/tasks/"+id, nil, c, ""), 404)
	list := object(t, req(s, "GET", "/api/v1/tasks", nil, c, ""), 200)
	if len(list["items"].([]any)) != 0 {
		t.Fatal("deleted task still listed")
	}
}
func TestTasksValidationAndForeignOwnership(t *testing.T) {
	s, _ := testServer(t)
	a, ac := register(t, s, "a@example.com")
	b, bc := register(t, s, "b@example.com")
	group := object(t, command(s, "POST", "/api/v1/groups", map[string]any{"name": "Work", "color": "#2563eb"}, b, bc, uuid.NewString()), 201)
	for _, input := range []map[string]any{
		{"title": "  "}, {"title": "Invalid", "startTime": "09:00", "endTime": "10:00"},
		{"title": "Invalid", "scheduledDate": "2030-02-30"},
		{"title": "Invalid", "scheduledDate": "2030-04-01", "startTime": "23:00", "endTime": "01:00"},
		{"title": "Invalid", "estimatedPomodoros": 0}, {"title": "Invalid", "priority": "urgent"},
	} {
		object(t, command(s, "POST", "/api/v1/tasks", input, a, ac, uuid.NewString()), 422)
	}
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Foreign group", "groupId": group["id"]}, a, ac, uuid.NewString()), 404)
	task := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Private", "groupId": group["id"]}, b, bc, uuid.NewString()), 201)
	id := task["id"].(string)
	object(t, req(s, "GET", "/api/v1/tasks/"+id, nil, a, ""), 404)
	for _, method := range []string{"PATCH", "DELETE"} {
		object(t, command(s, method, "/api/v1/tasks/"+id, map[string]any{"expectedRevision": 1}, a, ac, uuid.NewString()), 404)
	}
	object(t, command(s, "POST", "/api/v1/tasks/"+id+"/completion", map[string]any{"complete": true, "expectedRevision": 1}, a, ac, uuid.NewString()), 404)
	object(t, command(s, "DELETE", "/api/v1/groups/"+group["id"].(string), map[string]any{"expectedRevision": 1}, a, ac, uuid.NewString()), 404)
	object(t, command(s, "DELETE", "/api/v1/groups/"+group["id"].(string), map[string]any{"expectedRevision": 1}, b, bc, uuid.NewString()), 200)
	current := object(t, req(s, "GET", "/api/v1/tasks/"+id, nil, b, ""), 200)
	if current["groupId"] != nil || current["revision"] != float64(2) {
		t.Fatal("group removal did not detach and revise task")
	}
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "No key"}, a, ac, ""), 422)
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "No CSRF"}, a, "", uuid.NewString()), 403)
}
func TestTaskWriteRollsBackWhenEventFails(t *testing.T) {
	s, p := testServer(t)
	c, csrf := register(t, s, "rollback-task@example.com")
	_, err := p.Exec(context.Background(), `ALTER TABLE task_events ADD CONSTRAINT test_reject_events CHECK(false) NOT VALID`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `ALTER TABLE task_events DROP CONSTRAINT test_reject_events`)
	})
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Must roll back"}, c, csrf, uuid.NewString()), 500)
	var tasks, receipts int
	if e := p.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM tasks),(SELECT count(*) FROM mutation_receipts)`).Scan(&tasks, &receipts); e != nil {
		t.Fatal(e)
	}
	if tasks != 0 || receipts != 0 {
		t.Fatal("partial task mutation committed", tasks, receipts)
	}
}

func TestConcurrentTaskCommandsSerializeAndReplay(t *testing.T) {
	s, p := testServer(t)
	c, csrf := register(t, s, "concurrent@example.com")
	key := uuid.NewString()
	results := make(chan *httptest.ResponseRecorder, 2)
	for range 2 {
		go func() {
			results <- command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Only once"}, c, csrf, key)
		}()
	}
	a, b := <-results, <-results
	first := object(t, a, 201)
	object(t, b, 201)
	if a.Body.String() != b.Body.String() {
		t.Fatal("concurrent duplicate created different tasks")
	}
	id := first["id"].(string)
	for _, title := range []string{"Device A", "Device B"} {
		go func(v string) {
			results <- command(s, "PATCH", "/api/v1/tasks/"+id, map[string]any{"title": v, "expectedRevision": 1}, c, csrf, uuid.NewString())
		}(title)
	}
	a, b = <-results, <-results
	if (a.Code != 200 || b.Code != 409) && (a.Code != 409 || b.Code != 200) {
		t.Fatalf("lost update: %d %d", a.Code, b.Code)
	}
	var count int
	if e := p.QueryRow(context.Background(), `SELECT count(*) FROM tasks`).Scan(&count); e != nil {
		t.Fatal(e)
	}
	if count != 1 {
		t.Fatal("duplicate task")
	}
}
func TestTaskFutureCompletionAndReopenEvents(t *testing.T) {
	s, p := testServer(t)
	s.now = func() time.Time { return time.Date(2030, 4, 1, 12, 0, 0, 0, time.UTC) }
	c, csrf := register(t, s, "future@example.com")
	task := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Future", "scheduledDate": "2030-04-02", "startTime": "09:07", "endTime": "10:03"}, c, csrf, uuid.NewString()), 201)
	id := task["id"].(string)
	done := object(t, command(s, "POST", "/api/v1/tasks/"+id+"/completion", map[string]any{"complete": true, "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	if done["scheduledDate"] != "2030-04-02" || done["completedAt"] != "2030-04-01T12:00:00Z" || done["startTime"] != "09:07" || done["endTime"] != "10:03" {
		t.Fatal("move changed time precision", done)
	}
	object(t, command(s, "POST", "/api/v1/tasks/"+id+"/completion", map[string]any{"complete": false, "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	var valid int
	if e := p.QueryRow(context.Background(), `SELECT count(*) FROM task_events WHERE kind='completed' AND invalidated_at IS NULL`).Scan(&valid); e != nil {
		t.Fatal(e)
	}
	if valid != 0 {
		t.Fatal("same-day reopening retained completion")
	}
}
func TestTaskFiltersPaginationAndSettingsIsolation(t *testing.T) {
	s, _ := testServer(t)
	a, ac := register(t, s, "filter@example.com")
	b, _ := register(t, s, "other@example.com")
	for _, title := range []string{"Find 100%", "Find second", "Ignore"} {
		object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": title}, a, ac, uuid.NewString()), 201)
	}
	page := object(t, req(s, "GET", "/api/v1/tasks?search=Find&view=unscheduled&limit=1", nil, a, ""), 200)
	items := page["items"].([]any)
	if len(items) != 1 || page["nextCursor"] == nil {
		t.Fatal(page)
	}
	second := object(t, req(s, "GET", "/api/v1/tasks?search=Find&view=unscheduled&limit=1&cursor="+page["nextCursor"].(string), nil, a, ""), 200)
	if len(second["items"].([]any)) != 1 || second["nextCursor"] != nil || second["items"].([]any)[0].(map[string]any)["id"] == items[0].(map[string]any)["id"] {
		t.Fatal(second)
	}
	exact := object(t, req(s, "GET", "/api/v1/tasks?search=%25", nil, a, ""), 200)
	if len(exact["items"].([]any)) != 1 {
		t.Fatal("search interpreted literal as wildcard")
	}
	foreign := object(t, req(s, "GET", "/api/v1/tasks", nil, b, ""), 200)
	if len(foreign["items"].([]any)) != 0 {
		t.Fatal("foreign tasks leaked")
	}
	settings := object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"appearance": "dark", "timezone": "Asia/Tokyo", "expectedRevision": 1}, a, ac, uuid.NewString()), 200)
	if settings["appearance"] != "dark" || settings["focusMinutes"] != float64(25) {
		t.Fatal(settings)
	}
	other := object(t, req(s, "GET", "/api/v1/settings", nil, b, ""), 200)
	if other["appearance"] != "light" || other["timezone"] != "UTC" {
		t.Fatal("settings crossed accounts")
	}
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"appearance": "light", "expectedRevision": 1}, a, ac, uuid.NewString()), 409)
	for _, patch := range []map[string]any{{"focusMinutes": 0, "expectedRevision": 2}, {"timezone": "Invalid/Zone", "expectedRevision": 2}, {"sound": nil, "expectedRevision": 2}} {
		object(t, command(s, "PATCH", "/api/v1/settings", patch, a, ac, uuid.NewString()), 422)
	}
}
