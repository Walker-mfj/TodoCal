package controllers

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func focusActive(t *testing.T, s *Server, c *http.Cookie) map[string]any {
	t.Helper()
	return object(t, req(s, "GET", "/api/v1/focus", nil, c, ""), 200)
}
func TestFocusElapsedPauseCatchupAndIndependence(t *testing.T) {
	s, _ := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "focus@example.com")
	task := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Read"}, c, csrf, uuid.NewString()), 201)
	start := func() map[string]any {
		return object(t, command(s, "POST", "/api/v1/focus", map[string]any{"taskId": task["id"], "kind": "focus"}, c, csrf, uuid.NewString()), 201)["active"].(map[string]any)
	}
	a := start()
	if a["targetSeconds"] != float64(1500) {
		t.Fatal(a)
	}
	id := a["id"].(string)
	now = now.Add(10 * time.Minute)
	paused := object(t, command(s, "POST", "/api/v1/focus/"+id+"/pause", map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)["active"].(map[string]any)
	if paused["elapsedSeconds"] != float64(600) {
		t.Fatal(paused)
	}
	now = now.Add(time.Hour)
	renewTestSession(t, s, c, &csrf)
	ended := object(t, command(s, "POST", "/api/v1/focus/"+id+"/end", map[string]any{"expectedRevision": 2}, c, csrf, uuid.NewString()), 200)["last"].(map[string]any)
	if ended["focusSeconds"] != float64(600) || ended["pomodoros"] != float64(0) {
		t.Fatal(ended)
	}
	a = start()
	now = now.Add(2 * time.Hour)
	renewTestSession(t, s, c, &csrf)
	state := focusActive(t, s, c)
	if state["active"] != nil || state["last"].(map[string]any)["focusSeconds"] != float64(1500) || state["last"].(map[string]any)["pomodoros"] != float64(1) {
		t.Fatal(state)
	}
	current := object(t, req(s, "GET", "/api/v1/tasks/"+task["id"].(string), nil, c, ""), 200)
	if current["status"] != "incomplete" {
		t.Fatal(current)
	}
	// Reads and duplicate ends never create another session or completion.
	object(t, command(s, "POST", "/api/v1/focus/"+a["id"].(string)+"/end", map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	if focusActive(t, s, c)["completedFocusSessions"] != float64(1) {
		t.Fatal("duplicate completion")
	}
}
func TestFocusDefaultsCycleSettingsAndValidation(t *testing.T) {
	s, _ := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "cycle@example.com")
	for i := 1; i <= 4; i++ {
		a := object(t, command(s, "POST", "/api/v1/focus", map[string]any{"kind": "focus", "taskId": nil}, c, csrf, uuid.NewString()), 201)["active"].(map[string]any)
		if a["targetSeconds"] != float64(1500) {
			t.Fatal(a)
		}
		now = now.Add(25 * time.Minute)
		state := focusActive(t, s, c)
		kind := "short_break"
		duration := 300.
		if i == 4 {
			kind = "long_break"
			duration = 900
		}
		if state["nextKind"] != kind {
			t.Fatal(state)
		}
		b := object(t, command(s, "POST", "/api/v1/focus", map[string]any{"kind": kind}, c, csrf, uuid.NewString()), 201)["active"].(map[string]any)
		if b["targetSeconds"] != duration {
			t.Fatal(b)
		}
		now = now.Add(time.Duration(duration) * time.Second)
		renewTestSession(t, s, c, &csrf)
		state = focusActive(t, s, c)
		if state["last"].(map[string]any)["focusSeconds"] != float64(0) || state["nextKind"] != "focus" {
			t.Fatal(state)
		}
	}
	a := object(t, command(s, "POST", "/api/v1/focus", map[string]any{"kind": "focus"}, c, csrf, uuid.NewString()), 201)["active"].(map[string]any)
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"focusMinutes": 10, "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	if focusActive(t, s, c)["active"].(map[string]any)["targetSeconds"] != float64(1500) {
		t.Fatal("active setting changed")
	}
	object(t, command(s, "POST", "/api/v1/focus/"+a["id"].(string)+"/end", map[string]any{"expectedRevision": 1, "elapsedSeconds": 99999}, c, csrf, uuid.NewString()), 422)
	now = now.Add(25 * time.Minute)
	// Start settles an expired session before claiming the slot.
	b := object(t, command(s, "POST", "/api/v1/focus", map[string]any{"kind": "focus"}, c, csrf, uuid.NewString()), 201)["active"].(map[string]any)
	if b["targetSeconds"] != float64(600) {
		t.Fatal(b)
	}
}
func TestFocusConcurrentDevicesOwnershipAndRevisions(t *testing.T) {
	s, p := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "devices@example.com")
	login := req(s, "POST", "/api/v1/auth/login", map[string]string{"email": "devices@example.com", "password": "correct horse battery"}, nil, "")
	out := object(t, login, 200)
	c2 := login.Result().Cookies()[0]
	csrf2 := out["csrfToken"].(string)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			cookie, token := c, csrf
			if i == 1 {
				cookie, token = c2, csrf2
			}
			codes <- command(s, "POST", "/api/v1/focus", map[string]any{"kind": "focus"}, cookie, token, uuid.NewString()).Code
		}(i)
	}
	wg.Wait()
	close(codes)
	success := 0
	for code := range codes {
		if code == 201 {
			success++
		} else if code != 409 {
			t.Fatal(code)
		}
	}
	if success != 1 {
		t.Fatal(success)
	}
	a := focusActive(t, s, c)["active"].(map[string]any)
	id := a["id"].(string)
	other, otherCSRF := register(t, s, "foreign@example.com")
	object(t, command(s, "POST", "/api/v1/focus/"+id+"/pause", map[string]any{"expectedRevision": 1}, other, otherCSRF, uuid.NewString()), 404)
	object(t, command(s, "POST", "/api/v1/focus/"+id+"/pause", map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/focus/"+id+"/resume", map[string]any{"expectedRevision": 1}, c2, csrf2, uuid.NewString()), 409)
	object(t, command(s, "POST", "/api/v1/focus", map[string]any{"kind": "short_break"}, c2, csrf2, uuid.NewString()), 409)
	now = now.Add(time.Minute)
	object(t, command(s, "POST", "/api/v1/focus/"+id+"/resume", map[string]any{"expectedRevision": 2}, c2, csrf2, uuid.NewString()), 200)
	now = now.Add(25 * time.Minute)
	codes = make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes <- command(s, "POST", "/api/v1/focus/"+id+"/end", map[string]any{"expectedRevision": 3}, c, csrf, uuid.NewString()).Code
		}()
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 200 {
			t.Fatal(code)
		}
	}
	var n int
	if err := p.QueryRow(context.Background(), `SELECT count(*) FROM focus_sessions WHERE pomodoros=1`).Scan(&n); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	b, _ := json.Marshal(focusActive(t, s, other))
	if string(b) == "" {
		t.Fatal("missing state")
	}
	if focusActive(t, s, other)["active"] != nil {
		t.Fatal("foreign session leaked")
	}
}

func TestFocusLastSessionUsesCreationOrderForEqualTimestamps(t *testing.T) {
	s, p := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, _ := register(t, s, "order@example.com")
	for _, id := range []string{"ffffffff-ffff-4fff-8fff-ffffffffffff", "00000000-0000-4000-8000-000000000001"} {
		_, e := p.Exec(context.Background(), `INSERT INTO focus_sessions(user_id,id,kind,status,target_seconds,started_at,ended_at) SELECT id,$1,'focus','ended',1500,$2,$2 FROM users WHERE email='order@example.com'`, id, now)
		if e != nil {
			t.Fatal(e)
		}
	}
	if focusActive(t, s, c)["last"].(map[string]any)["id"] != "00000000-0000-4000-8000-000000000001" {
		t.Fatal("last session ordered by random UUID")
	}
}

func TestFocusOwnershipDeletedTaskAndIdempotentStart(t *testing.T) {
	s, p := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "focus-history@example.com")
	other, token := register(t, s, "focus-other@example.com")
	task := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "Retained focus"}, c, csrf, uuid.NewString()), 201)
	taskID := task["id"].(string)
	object(t, command(s, "POST", "/api/v1/focus", map[string]any{"kind": "focus", "taskId": taskID}, other, token, uuid.NewString()), 404)
	key := uuid.NewString()
	body := map[string]any{"kind": "focus", "taskId": taskID}
	a := object(t, command(s, "POST", "/api/v1/focus", body, c, csrf, key), 201)["active"].(map[string]any)
	again := object(t, command(s, "POST", "/api/v1/focus", body, c, csrf, key), 201)["active"].(map[string]any)
	if a["id"] != again["id"] {
		t.Fatal("start retry duplicated session")
	}
	object(t, command(s, "DELETE", "/api/v1/tasks/"+taskID, map[string]any{"expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	now = now.Add(25 * time.Minute)
	state := focusActive(t, s, c)
	if state["last"].(map[string]any)["taskTitle"] != "Retained focus" {
		t.Fatal(state)
	}
	var seconds float64
	if e := p.QueryRow(context.Background(), `SELECT sum(extract(epoch FROM (ended_at-started_at))) FROM focus_intervals`).Scan(&seconds); e != nil || seconds != 1500 {
		t.Fatal(seconds, e)
	}
	object(t, command(s, "POST", "/api/v1/focus", body, c, csrf, uuid.NewString()), 404)
}
