package workers

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"focuscalendar/internal/database"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestNotificationAccountTimeoutFairness(t *testing.T) {
	url := os.Getenv("SCHEDULER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("SCHEDULER_TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if !strings.HasSuffix(pool.Config().ConnConfig.Database, "_test") {
		t.Fatal("isolated test database required")
	}
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	for _, job := range []Job{Focus, Horizon} {
		name := "Focus"
		if job == Horizon {
			name = "Horizon"
		}
		t.Run(name, func(t *testing.T) {
			exec := func(sql string, args ...any) {
				t.Helper()
				if _, e := pool.Exec(ctx, sql, args...); e != nil {
					t.Fatal(e)
				}
			}
			exec("TRUNCATE users CASCADE")
			now := time.Now().UTC()
			first := "00000000-0000-0000-0000-000000000001"
			second := "00000000-0000-0000-0000-000000000002"
			for _, user := range []string{first, second} {
				exec("INSERT INTO users(id,email,password_hash) VALUES($1,$2,'test-only')", user, user+"@scheduler.test")
				exec("INSERT INTO settings(user_id) VALUES($1)", user)
				exec(`INSERT INTO focus_sessions(user_id,id,kind,status,target_seconds,running_since,started_at)
     VALUES($1,$2,'focus','running',60,$3,$3)`, user, uuid.NewString(), now.Add(-2*time.Minute))
			}
			exec("UPDATE notification_horizons SET next_run_at=$1", now.Add(-time.Minute))
			backend := &NotificationSchedule{Pool: pool, Now: func() time.Time { return now }}
			blocker, e := pool.Begin(ctx)
			if e != nil {
				t.Fatal(e)
			}
			defer func() { _ = blocker.Rollback(ctx) }()
			if _, e = blocker.Exec(ctx, "SELECT user_id FROM settings WHERE user_id=$1 FOR UPDATE", first); e != nil {
				t.Fatal(e)
			}
			timedAttempt := func() {
				t.Helper()
				attempt, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
				defer cancel()
				if e := backend.Run(attempt, job); !errors.Is(e, context.DeadlineExceeded) {
					t.Fatalf("expected blocked account timeout, got %v", e)
				}
			}
			finished := func(user string) bool {
				t.Helper()
				var done bool
				query := "SELECT status='completed' FROM focus_sessions WHERE user_id=$1"
				if job == Horizon {
					query = "SELECT next_run_at>$2 FROM notification_horizons WHERE user_id=$1"
				}
				args := []any{user}
				if job == Horizon {
					args = append(args, now)
				}
				if e := pool.QueryRow(ctx, query, args...).Scan(&done); e != nil {
					t.Fatal(e)
				}
				return done
			}
			timedAttempt() // A fails; cursor must advance despite rollback.
			attempt, cancel := context.WithTimeout(ctx, time.Second)
			e = backend.Run(attempt, job)
			cancel()
			if e != nil || !finished(second) {
				t.Fatalf("healthy second account starved: %v", e)
			}
			if finished(first) {
				t.Fatal("failed account's unfinished work was discarded")
			}
			timedAttempt() // Wrap retries A; it was not silently abandoned.
			if e = blocker.Rollback(ctx); e != nil {
				t.Fatal(e)
			}
			if e = backend.Run(ctx, job); e != nil || !finished(first) {
				t.Fatalf("recovered account did not finish: %v", e)
			}
		})
	}
}
