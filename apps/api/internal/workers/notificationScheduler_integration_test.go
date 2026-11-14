package workers

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"focuscalendar/internal/database"
	"focuscalendar/internal/models"
	"focuscalendar/internal/services"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type schedulerPush struct{ status, calls int }

func (p *schedulerPush) Send(context.Context, models.PushInput, []byte) (int, error) {
	p.calls++
	return p.status, nil
}

func TestNotificationSchedulerDatabase(t *testing.T) {
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
	if _, err = pool.Exec(ctx, "TRUNCATE users, auth_attempts CASCADE"); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 14, 10, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	auth := services.Auth{Pool: pool, Now: clock}
	session, err := auth.Register(ctx, services.Credentials{Email: "scheduler@example.com", Password: "correct horse battery", Timezone: "UTC"}, "scheduler-test")
	if err != nil {
		t.Fatal(err)
	}
	principal, err := auth.Authenticate(ctx, session.Token)
	if err != nil {
		t.Fatal(err)
	}
	// The shared account transaction publishes only after its data is visible.
	wakes := 0
	wakeCtx := database.WithScheduleWake(ctx, func() {
		wakes++
		var zone string
		if e := pool.QueryRow(ctx, "SELECT timezone FROM settings WHERE user_id=$1", principal.ID).Scan(&zone); e != nil || zone != "Asia/Tokyo" {
			t.Errorf("wake before committed data: %s %v", zone, e)
		}
	})
	if err = database.WithTx(wakeCtx, pool, principal.ID, func(tx pgx.Tx, _ string) error {
		_, e := tx.Exec(wakeCtx, "UPDATE settings SET timezone='Asia/Tokyo' WHERE user_id=$1", principal.ID)
		return e
	}); err != nil {
		t.Fatal(err)
	}
	rollback := errors.New("rollback")
	if err = database.WithTx(wakeCtx, pool, principal.ID, func(tx pgx.Tx, _ string) error {
		_, e := tx.Exec(wakeCtx, "UPDATE settings SET timezone='UTC' WHERE user_id=$1", principal.ID)
		if e != nil {
			return e
		}
		return rollback
	}); !errors.Is(err, rollback) || wakes != 1 {
		t.Fatalf("rollback wake: %d %v", wakes, err)
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, e := pool.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec("UPDATE settings SET timezone='UTC' WHERE user_id=$1", principal.ID)
	exec(`INSERT INTO notification_preferences(user_id,task_start,focus_complete) VALUES($1,true,true)`, principal.ID)
	first, second := uuid.NewString(), uuid.NewString()
	for _, id := range []string{first, second} {
		exec(`INSERT INTO push_subscriptions(id,user_id,session_id,endpoint,p256dh,auth,created_at) VALUES($1,$2,$3,$4,'key','auth',$5)`, id, principal.ID, principal.SessionID, "https://fcm.googleapis.com/"+id, now.Add(-time.Hour))
	}
	task := uuid.NewString()
	exec(`INSERT INTO tasks(user_id,id,title,scheduled_date,start_time,end_time,created_at,updated_at) VALUES($1,$2,'scheduler','2026-11-14','10:00','10:30',$3,$3)`, principal.ID, task, now)
	sender := &schedulerPush{status: 503}
	w := services.NotificationWorker{Pool: pool, Now: clock, Sender: sender, EnforceLateness: true}
	backend := &NotificationSchedule{Pool: pool, Now: clock, Notifications: w}
	next, err := w.NextDue(ctx)
	if err != nil || !next.Equal(now) {
		t.Fatalf("initial next: %v %v", next, err)
	}
	// A terminal record for device A must not suppress device B's candidate.
	exec(`INSERT INTO notification_outbox(id,subscription_id,event_key,due_at,kind,next_attempt_at,finished_at,outcome)
 SELECT gen_random_uuid(),$1,event_key,due_at,kind,$2,$2,'sent'
 FROM notification_candidates WHERE user_id=$3 AND kind='task_start'`, first, now, principal.ID)
	next, err = w.NextDue(ctx)
	if err != nil || !next.Equal(now) {
		t.Fatalf("second device suppressed: %v %v", next, err)
	}
	// Device B becomes a retry entry; original candidate must not spin at 10:00.
	if _, err = w.Run(ctx, 3); err != nil {
		t.Fatal(err)
	}
	next, err = w.NextDue(ctx)
	if err != nil || !next.Equal(now.Add(time.Minute)) {
		t.Fatalf("retry deadline: %v %v", next, err)
	}
	if sender.calls != 1 {
		t.Fatalf("device attempts %d", sender.calls)
	}
	now = now.Add(time.Minute)
	sender.status = 201
	if _, err = w.Run(ctx, 3); err != nil {
		t.Fatal(err)
	}
	next, err = w.NextDue(ctx)
	if err != nil || !next.IsZero() {
		t.Fatalf("terminal dedupe: %v %v", next, err)
	}
	// A valid candidate may still be within the legacy 24h window but too late
	// under the scheduler policy. Queued retries must cancel without sending.
	now = now.Add(10 * time.Minute)
	exec("UPDATE notification_outbox SET finished_at=NULL,next_attempt_at=$1 WHERE subscription_id=$2", now, first)
	attemptsBefore := sender.calls
	if _, err = w.Run(ctx, 3); err != nil {
		t.Fatal(err)
	}
	var outcome string
	if err = pool.QueryRow(ctx, "SELECT outcome FROM notification_outbox WHERE subscription_id=$1", first).Scan(&outcome); err != nil || outcome != "canceled" || sender.calls != attemptsBefore {
		t.Fatalf("expired retry: %s calls=%d %v", outcome, sender.calls, err)
	}

	// Settlement retains the original completion time, so stale pushes expire.
	focus := uuid.NewString()
	exec(`INSERT INTO focus_sessions(user_id,id,kind,status,target_seconds,running_since,started_at) VALUES($1,$2,'focus','running',60,$3,$3)`, principal.ID, focus, now.Add(-time.Hour))
	due, err := backend.Next(ctx)
	if err != nil || due[Focus].IsZero() {
		t.Fatalf("focus deadline %v %v", due, err)
	}
	if err = backend.Run(ctx, Focus); err != nil {
		t.Fatal(err)
	}
	var status string
	if err = pool.QueryRow(ctx, "SELECT status FROM focus_sessions WHERE id=$1", focus).Scan(&status); err != nil || status != "completed" {
		t.Fatalf("focus %s %v", status, err)
	}
	before := sender.calls
	if _, err = w.Run(ctx, 3); err != nil {
		t.Fatal(err)
	}
	if sender.calls != before {
		t.Fatal("stale focus sent")
	}

	// Horizon deadlines survive process restarts, and settings edits invalidate them.
	exec("UPDATE notification_horizons SET next_run_at=$1", now)
	if err = backend.Run(ctx, Horizon); err != nil {
		t.Fatal(err)
	}
	var horizon time.Time
	if err = pool.QueryRow(ctx, "SELECT next_run_at FROM notification_horizons WHERE user_id=$1", principal.ID).Scan(&horizon); err != nil || !horizon.After(now) {
		t.Fatalf("horizon %v %v", horizon, err)
	}
	exec("UPDATE notification_horizons SET next_run_at=CURRENT_TIMESTAMP+interval '2 days' WHERE user_id=$1", principal.ID)
	exec("UPDATE settings SET timezone='Asia/Tokyo' WHERE user_id=$1", principal.ID)
	var invalidated bool
	if err = pool.QueryRow(ctx, "SELECT next_run_at<=CURRENT_TIMESTAMP FROM notification_horizons WHERE user_id=$1", principal.ID).Scan(&invalidated); err != nil || !invalidated {
		t.Fatalf("invalidated horizon %v %v", horizon, err)
	}

	exec("UPDATE notification_outbox SET finished_at=$1", now.Add(-31*24*time.Hour))
	exec("UPDATE notification_maintenance SET next_run_at=$1", now)
	if err = backend.Run(ctx, Cleanup); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM notification_outbox").Scan(&count); err != nil || count != 0 {
		t.Fatalf("cleanup %d %v", count, err)
	}
	// A newer terminal row and an unfinished retry must survive retention.
	for i, finished := range []any{nil, now} {
		exec(`INSERT INTO notification_outbox(id,subscription_id,event_key,due_at,kind,next_attempt_at,finished_at)
		 VALUES($1,$2,$3,$4,'task_start',$4,$5)`, uuid.NewString(), first, "retained-"+string(rune('a'+i)), now, finished)
	}
	exec("UPDATE notification_maintenance SET next_run_at=$1", now)
	if err = backend.Run(ctx, Cleanup); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM notification_outbox").Scan(&count); err != nil || count != 2 {
		t.Fatalf("live rows removed: %d %v", count, err)
	}
}
