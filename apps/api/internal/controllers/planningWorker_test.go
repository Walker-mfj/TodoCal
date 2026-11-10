package controllers

import (
	"context"
	"testing"
	"time"

	"focuscalendar/internal/workers"

	"github.com/google/uuid"
)

func TestWorkerAndAPIConcurrentlyFinalizeOnce(t *testing.T) {
	s, p := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "worker@example.com")
	series(t, s, c, csrf, "daily", 1, nil)
	now = atDate("2030-10-22")
	renewTestSession(t, s, c, &csrf)
	results := make(chan error, 1)
	go func() { _, e := workers.Sweep(context.Background(), p, s.now); results <- e }()
	out := calendar(t, s, c, "2030-10-19", "2030-10-23")
	if e := <-results; e != nil {
		t.Fatal(e)
	}
	var occurrences, snapshots int
	if e := p.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM tasks),(SELECT count(*) FROM daily_snapshots)`).Scan(&occurrences, &snapshots); e != nil {
		t.Fatal(e)
	}
	// Four catch-up days plus two future local days for reminder scheduling.
	if occurrences != 6 || snapshots != 3 {
		t.Fatal("duplicate or missing catch-up", occurrences, snapshots, out)
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
	defer func() { _ = lock.Rollback(context.Background()) }()
	if _, e = lock.Exec(context.Background(), `SELECT user_id FROM settings WHERE user_id=$1 FOR UPDATE`, first); e != nil {
		t.Fatal(e)
	}
	now = atDate("2030-10-20")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, _ = workers.Sweep(ctx, p, s.now)
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
	runner := &workers.Sweeper{}
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
