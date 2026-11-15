package controllers

import (
	"context"
	"testing"
	"time"

	"focuscalendar/internal/services"
	"github.com/jackc/pgx/v5"
)

func TestConcurrentAPICatchUpFinalizesOnce(t *testing.T) {
	s, p := testServer(t)
	now := atDate("2030-10-19")
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "worker@example.com")
	sr := series(t, s, c, csrf, "daily", 1, nil)
	var user string
	if e := p.QueryRow(context.Background(), "SELECT user_id FROM recurrence_series WHERE id=$1", sr["id"]).Scan(&user); e != nil {
		t.Fatal(e)
	}
	now = atDate("2030-10-22")
	renewTestSession(t, s, c, &csrf)
	results := make(chan error, 1)
	go func() {
		results <- services.WithTx(context.Background(), p, user, s.now, func(pgx.Tx, string, time.Time) error { return nil })
	}()
	out := calendar(t, s, c, "2030-10-19", "2030-10-23")
	if e := <-results; e != nil {
		t.Fatal(e)
	}
	var occurrences, snapshots int
	if e := p.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM tasks),(SELECT count(*) FROM daily_snapshots)`).Scan(&occurrences, &snapshots); e != nil {
		t.Fatal(e)
	}
	// Three historical days plus today; reminder horizons are tested separately.
	if occurrences != 4 || snapshots != 3 {
		t.Fatal("duplicate or missing catch-up", occurrences, snapshots, out)
	}
}
