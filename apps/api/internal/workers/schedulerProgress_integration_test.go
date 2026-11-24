package workers

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"focuscalendar/internal/database"
	"focuscalendar/internal/services"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func progressDB(t *testing.T) (*pgxpool.Pool, func(string, ...any), string) {
	t.Helper()
	url := os.Getenv("SCHEDULER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("SCHEDULER_TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if !strings.HasSuffix(pool.Config().ConnConfig.Database, "_test") {
		t.Fatal("isolated test database required")
	}
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := pool.Exec(ctx, q, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec("TRUNCATE users CASCADE")
	user := uuid.NewString()
	exec("INSERT INTO users(id,email,password_hash) VALUES($1,'progress@scheduler.test','test-only')", user)
	exec("INSERT INTO settings(user_id) VALUES($1)", user)
	return pool, exec, user
}

const progressSeriesSQL = `INSERT INTO recurrence_series(user_id,id,template,start_date,cadence,interval_days,created_at)
 VALUES($1,$2,'{"title":"recurring","priority":"medium","startTime":"12:00","endTime":"12:30"}', $3::timestamptz::date,'daily',1,$3)`

// Exercise the same View boundary and query used by GET /focus. Its implicit
// planning materialization must publish only when it actually creates tasks.
func TestScheduleWakeFromViews(t *testing.T) {
	pool, exec, user := progressDB(t)
	now := time.Now().UTC()
	calls := 0
	ctx := database.WithScheduleWake(context.Background(), func() { calls++ })
	view := func() {
		t.Helper()
		_, err := services.View(ctx, pool, func() time.Time { return now }, services.Principal{User: services.User{ID: user}}, services.Parameters{}, services.FocusStateCommand)
		if err != nil {
			t.Fatal(err)
		}
	}
	view()
	view()
	if calls != 0 {
		t.Fatalf("read-only views published %d wakes", calls)
	}
	exec(`INSERT INTO focus_sessions(user_id,id,kind,status,target_seconds,running_since,started_at) VALUES($1,$2,'focus','running',60,$3,$3)`, user, uuid.NewString(), now.Add(-2*time.Minute))
	view()
	if calls != 1 {
		t.Fatalf("focus settlement wakes=%d", calls)
	}
	view()
	if calls != 1 {
		t.Fatal("settled focus woke again")
	}
	exec(progressSeriesSQL, user, uuid.NewString(), now)
	view()
	if calls != 2 {
		t.Fatalf("materialization wakes=%d", calls)
	}
	view()
	if calls != 2 {
		t.Fatal("already materialized task woke again")
	}
	// Transaction-local dirty state must not leak through pooled connections.
	for i := 0; i < 10; i++ {
		view()
	}
	if calls != 2 {
		t.Fatal("dirty state leaked into later reads")
	}
}

func TestHorizonDurableProgressAndDormancy(t *testing.T) {
	pool, exec, user := progressDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	var due *time.Time
	readDue := func() {
		t.Helper()
		if e := pool.QueryRow(ctx, "SELECT next_run_at FROM notification_horizons WHERE user_id=$1", user).Scan(&due); e != nil {
			t.Fatal(e)
		}
	}
	readDue()
	if due != nil {
		t.Fatal("empty account scheduled")
	}
	const count = 100
	for i := 1; i <= count; i++ {
		exec(progressSeriesSQL, user, fmt.Sprintf("00000000-0000-0000-0000-%012d", i), now)
	}
	readDue()
	if due != nil {
		t.Fatal("disabled reminders scheduled")
	}
	exec("INSERT INTO notification_preferences(user_id,task_start) VALUES($1,true)", user)
	exec("UPDATE notification_horizons SET next_run_at=$1 WHERE user_id=$2", now, user)
	run := func() {
		t.Helper()
		attempt, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		// Fresh backend every attempt simulates restarts: progress cannot live in RAM.
		backend := &NotificationSchedule{Pool: pool, Now: func() time.Time { return now }}
		if e := backend.Run(attempt, Horizon); e != nil {
			t.Fatal(e)
		}
	}
	for i := 1; i <= count; i++ {
		if i == 2 {
			// A timeout between batches must preserve the first committed cursor.
			cancelled, cancel := context.WithCancel(ctx)
			cancel()
			backend := &NotificationSchedule{Pool: pool, Now: func() time.Time { return now }}
			if e := backend.Run(cancelled, Horizon); e == nil {
				t.Fatal("cancelled batch succeeded")
			}
		}
		run()
		var n int
		if e := pool.QueryRow(ctx, "SELECT count(DISTINCT series_id) FROM tasks WHERE user_id=$1", user).Scan(&n); e != nil {
			t.Fatal(e)
		}
		if n != i {
			t.Fatalf("batch %d: completed series=%d", i, n)
		}
	}
	run()
	readDue()
	if due == nil || !due.After(now) {
		t.Fatal("completed cycle did not schedule midnight")
	}
	exec("UPDATE notification_preferences SET task_start=false WHERE user_id=$1", user)
	readDue()
	if due != nil {
		t.Fatal("disabled reminders remain scheduled")
	}
	exec("UPDATE notification_preferences SET task_start=true WHERE user_id=$1", user)
	readDue()
	if due == nil {
		t.Fatal("reenabled reminders did not invalidate horizon")
	}
	exec("UPDATE recurrence_series SET original_cutoff=$2::timestamptz::date WHERE user_id=$1", user, now)
	readDue()
	if due != nil {
		t.Fatal("deleted following occurrences remain scheduled")
	}
	exec("UPDATE recurrence_series SET original_cutoff=NULL WHERE user_id=$1", user)
	readDue()
	if due == nil {
		t.Fatal("restored following occurrences did not reactivate horizon")
	}
	exec("UPDATE recurrence_series SET stopped_after=($2::timestamptz::date-1) WHERE user_id=$1", user, now)
	readDue()
	if due != nil {
		t.Fatal("stopped series remain scheduled")
	}
	// Pure deadline reminders also need a horizon; negative offsets must be
	// materialized even when their occurrence is far outside today's calendar.
	exec("UPDATE notification_preferences SET task_start=false,deadline=true WHERE user_id=$1", user)
	exec(`UPDATE recurrence_series SET stopped_after=NULL,deadline_offset=-10,deadline_time='09:00:00'
 WHERE user_id=$1 AND id='00000000-0000-0000-0000-000000000001'`, user)
	exec("UPDATE notification_horizons SET next_run_at=$1 WHERE user_id=$2", now, user)
	run()
	var n int
	if e := pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE user_id=$1 AND scheduled_date=($2::timestamptz::date+10)`, user, now).Scan(&n); e != nil || n != 1 {
		t.Fatalf("negative-offset deadline missing: %d %v", n, e)
	}
}

func TestTaskScheduleDirtyFields(t *testing.T) {
	pool, exec, user := progressDB(t)
	now := time.Now().UTC()
	task := uuid.NewString()
	exec(`INSERT INTO tasks(user_id,id,title,scheduled_date,start_time,end_time,created_at,updated_at)
 VALUES($1,$2,'before',$3::timestamptz::date,'12:00','13:00',$3,$3)`, user, task, now)
	calls := 0
	ctx := database.WithScheduleWake(context.Background(), func() { calls++ })
	update := func(set string) {
		t.Helper()
		err := database.WithTx(ctx, pool, user, func(tx pgx.Tx, _ string) error {
			_, err := tx.Exec(ctx, "UPDATE tasks SET "+set+" WHERE user_id=$1 AND id=$2", user, task)
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	update("title='after',description='edited',priority='high',revision=revision+1,updated_at=CURRENT_TIMESTAMP")
	update("end_time='14:00',scheduled_end_at=scheduled_end_at+interval '1 hour'")
	if calls != 0 {
		t.Fatal("presentation-only changes woke scheduler")
	}
	for i, set := range []string{"scheduled_date=scheduled_date+1,scheduled_end_date=scheduled_end_date+1,scheduled_start_at=scheduled_start_at+interval '1 day',scheduled_end_at=scheduled_end_at+interval '1 day'", "start_time='12:30',scheduled_start_at=scheduled_start_at+interval '30 minutes'", "deadline=CURRENT_TIMESTAMP+interval '1 day'", "status='complete'", "deleted_at=CURRENT_TIMESTAMP", "deleted_at=NULL"} {
		update(set)
		if calls != i+1 {
			t.Fatalf("schedule change %q missing wake", set)
		}
	}
	update("start_time=start_time,deadline=deadline,status=status,revision=revision+1")
	if calls != 6 {
		t.Fatal("no-op schedule update woke scheduler")
	}
}

func TestHorizonSingleLargeSeries(t *testing.T) {
	pool, exec, user := progressDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	series := uuid.NewString()
	exec(progressSeriesSQL, user, series, now)
	exec(`UPDATE recurrence_series SET start_date=$3::timestamptz::date-200000,deadline_offset=-10,deadline_time='09:00:00'
 WHERE user_id=$1 AND id=$2`, user, series, now)
	exec("INSERT INTO notification_preferences(user_id,task_start,deadline) VALUES($1,true,true)", user)
	exec(`INSERT INTO tasks(user_id,id,title,series_id,original_occurrence_date,scheduled_date,created_at,updated_at)
 SELECT $1,md5('history'||g)::uuid,'history',$2,$3::timestamptz::date-g,$3::timestamptz::date-g,$3,$3
 FROM generate_series(1,100000) g`, user, series, now)
	exec(`INSERT INTO recurrence_exceptions(user_id,series_id,original_occurrence_date,reason,created_at)
 SELECT $1,$2,$3::timestamptz::date-100000-g,'invalid_local_time',$3 FROM generate_series(1,100000) g`, user, series, now)
	exec("ANALYZE tasks")
	exec("ANALYZE recurrence_exceptions")
	exec("ANALYZE recurrence_series")
	exec("UPDATE notification_horizons SET next_run_at=$1 WHERE user_id=$2", now, user)
	backend := &NotificationSchedule{Pool: pool, Now: func() time.Time { return now }}
	attempt, cancel := context.WithTimeout(ctx, 2*time.Second)
	started := time.Now()
	err := backend.Run(attempt, Horizon)
	elapsed := time.Since(started)
	cancel()
	t.Logf("one series, 100k occurrences + 100k exceptions: %s", elapsed)
	if err != nil {
		t.Fatalf("bounded series exceeded budget or failed: %v", err)
	}
	var after string
	if err = pool.QueryRow(ctx, "SELECT after_series::text FROM notification_horizons WHERE user_id=$1", user).Scan(&after); err != nil || after != series {
		t.Fatalf("progress not committed: %s %v", after, err)
	}
	var count int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM tasks WHERE user_id=$1 AND scheduled_date >= $2::timestamptz::date", user, now).Scan(&count); err != nil || count != 8 {
		t.Fatalf("bounded horizon created %d occurrences: %v", count, err)
	}
	// A fresh backend must finish the page without redoing the large history.
	attempt, cancel = context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	backend = &NotificationSchedule{Pool: pool, Now: func() time.Time { return now }}
	if err = backend.Run(attempt, Horizon); err != nil {
		t.Fatal(err)
	}
	var due time.Time
	if err = pool.QueryRow(ctx, "SELECT next_run_at FROM notification_horizons WHERE user_id=$1", user).Scan(&due); err != nil || !due.After(now) {
		t.Fatalf("cycle did not finish: %v %v", due, err)
	}
}
