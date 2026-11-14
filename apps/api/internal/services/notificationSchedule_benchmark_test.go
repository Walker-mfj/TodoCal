package services_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"focuscalendar/internal/database"
	"focuscalendar/internal/models"
	"focuscalendar/internal/services"
	"focuscalendar/internal/workers"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Opt-in destructive benchmark, isolated from application and integration DBs.
// Captures the exact production query with EXPLAIN (ANALYZE, BUFFERS), then
// measures warm executions. Run with -benchtime=10x -count=1 -v to retain plans.
func BenchmarkNotificationSchedule(b *testing.B) {
	url := os.Getenv("SCHEDULER_BENCHMARK_DATABASE_URL")
	if url == "" {
		b.Skip("SCHEDULER_BENCHMARK_DATABASE_URL required")
	}
	ctx := context.Background()
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		b.Fatal(err)
	}
	config.ConnConfig.Tracer = benchmarkQueryTrace{}
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		b.Fatal(err)
	}
	defer pool.Close()
	if !strings.HasSuffix(pool.Config().ConnConfig.Database, "_scheduler_bench_test") {
		b.Fatal("dedicated *_scheduler_bench_test database required")
	}
	if err = database.Migrate(ctx, pool); err != nil {
		b.Fatal(err)
	}
	now := time.Date(2026, 11, 14, 10, 0, 0, 0, time.UTC)
	for _, size := range []int{1000, 10000, 100000} {
		for _, devices := range []int{1, 5} {
			b.Run(fmt.Sprintf("tasks_%d/devices_%d", size, devices), func(b *testing.B) {
				exec := func(q string, args ...any) {
					b.Helper()
					if _, err := pool.Exec(ctx, q, args...); err != nil {
						b.Fatal(err)
					}
				}
				exec("TRUNCATE users CASCADE")
				accounts := size / 10
				exec(`INSERT INTO users(id,email,password_hash) SELECT md5('user'||g)::uuid,'bench'||g||'@scheduler.test','test-only' FROM generate_series(1,$1::int) g`, accounts)
				exec(`INSERT INTO settings(user_id) SELECT id FROM users`)
				exec(`INSERT INTO notification_preferences(user_id,task_start,deadline,focus_complete) SELECT id,true,true,true FROM users`)
				exec(`INSERT INTO auth_sessions(id,user_id,token_hash,csrf_hash,expires_at)
 SELECT id,id,id::text,'test-only',$1::timestamptz+interval '1 day' FROM users`, now)
				exec(`INSERT INTO push_subscriptions(id,user_id,session_id,endpoint,p256dh,auth,created_at)
 SELECT md5(u.id::text||g)::uuid,u.id,u.id,'https://example.test/'||u.id||'/'||g,'key','auth',$2::timestamptz-interval '2 days'
 FROM users u CROSS JOIN generate_series(1,$1::int) g`, devices, now)
				// Mix archived, completed, due, and future tasks; growing accounts and multiple
				// devices exercise candidate generation and the per-device anti-join.
				exec(`INSERT INTO tasks(user_id,id,title,scheduled_date,start_time,end_time,deadline,status,created_at,updated_at)
 SELECT md5('user'||((g-1)%$3::int+1))::uuid,md5('task'||g)::uuid,'benchmark',
 $2::timestamptz::date+CASE WHEN g%4=0 THEN -30 WHEN g%4=1 THEN 0 ELSE g%30 END,
 '10:00'::time,'10:30'::time,$2::timestamptz+(g%60)*interval '1 minute',
 CASE WHEN g%10=0 THEN 'complete' ELSE 'incomplete' END,$2,$2 FROM generate_series(1,$1::int) g`, size, now, accounts)
				exec(`INSERT INTO notification_outbox(id,subscription_id,event_key,due_at,kind,next_attempt_at,finished_at,outcome)
 SELECT md5(s.id::text||c.event_key)::uuid,s.id,c.event_key,c.due_at,c.kind,$1,$1,'sent'
 FROM notification_candidates c JOIN push_subscriptions s ON s.user_id=c.user_id
 WHERE c.due_at BETWEEN $1::timestamptz-interval '10 minutes' AND $1 AND substring(s.id::text,1,1)<'8'`, now)

				exec(`INSERT INTO focus_sessions(user_id,id,kind,status,target_seconds,running_since,started_at)
 SELECT id,id,'focus','running',1500,$1,$1 FROM users`, now)
				exec(`INSERT INTO focus_sessions(user_id,id,kind,status,target_seconds,accumulated_us,started_at,ended_at)
 SELECT id,md5(id::text||g)::uuid,'focus','completed',1500,1500000000,$1::timestamptz-interval '30 minutes',$1::timestamptz-interval '5 minutes'
 FROM users CROSS JOIN generate_series(1,5) g`, now)
				exec(`UPDATE notification_horizons SET next_run_at=$1::timestamptz+interval '1 hour'`, now)
				exec(`UPDATE notification_maintenance SET next_run_at=$1::timestamptz+interval '1 day' WHERE name='cleanup'`, now)
				for _, table := range []string{"tasks", "settings", "notification_preferences", "push_subscriptions", "auth_sessions", "notification_outbox", "focus_sessions", "notification_horizons", "notification_maintenance"} {
					exec("ANALYZE " + table)
				}

				worker := services.NotificationWorker{Pool: pool, Now: func() time.Time { return now }, Sender: benchmarkSender{}, EnforceLateness: true}
				backend := &workers.NotificationSchedule{Pool: pool, Now: func() time.Time { return now }, Notifications: worker}
				// Capture the production SQL from the full call rather than duplicating query
				// text. Explain each constituent query after the first end-to-end measurement.
				captured := []pgx.TraceQueryStartData{}
				traceCtx := context.WithValue(ctx, benchmarkTraceKey{}, &captured)
				attempt, cancel := context.WithTimeout(traceCtx, 2*time.Second)
				started := time.Now()
				deadlines, err := backend.Next(attempt)
				first := time.Since(started)
				cancel()
				firstErr := err
				b.Logf("tasks=%d accounts=%d devices/account=%d first full Next=%s error=%v", size, accounts, devices, first, firstErr)
				for i, q := range captured {
					// Keep diagnostic plans even when the production budget was exceeded.
					explainCtx, stopExplain := context.WithTimeout(ctx, 30*time.Second)
					rows, err := pool.Query(explainCtx, "EXPLAIN (ANALYZE, BUFFERS) "+q.SQL, q.Args...)
					if err != nil {
						stopExplain()
						b.Fatal(err)
					}
					var plan strings.Builder
					for rows.Next() {
						var line string
						if err = rows.Scan(&line); err != nil {
							b.Fatal(err)
						}
						plan.WriteString(line + "\n")
					}
					err = rows.Err()
					rows.Close()
					stopExplain()
					if err != nil {
						b.Fatal(err)
					}
					b.Logf("Next query %d:\n%s", i+1, plan.String())
				}
				if firstErr != nil {
					b.Fatalf("first full Next exceeded budget or failed (%s): %v", first, firstErr)
				}
				for _, job := range []workers.Job{workers.Focus, workers.Dispatch, workers.Horizon, workers.Cleanup} {
					if deadlines[job].IsZero() {
						b.Fatalf("fixture omitted lane %d", job)
					}
				}
				for _, part := range []string{"candidate", "full_next"} {
					b.Run(part, func(b *testing.B) {
						var slowest time.Duration
						b.ResetTimer()
						for i := 0; i < b.N; i++ {
							attempt, cancel := context.WithTimeout(ctx, 2*time.Second)
							started := time.Now()
							if part == "candidate" {
								_, err = worker.NextDue(attempt)
							} else {
								_, err = backend.Next(attempt)
							}
							elapsed := time.Since(started)
							cancel()
							if elapsed > slowest {
								slowest = elapsed
							}
							if err != nil {
								b.Fatalf("%s failed (%s): %v", part, elapsed, err)
							}
						}
						b.ReportMetric(float64(slowest)/float64(time.Millisecond), "max_ms")
					})
				}
			})
		}
	}
}

type benchmarkSender struct{}

func (benchmarkSender) Send(context.Context, models.PushInput, []byte) (int, error) {
	panic("deadline benchmark must not send push")
}

type benchmarkTraceKey struct{}
type benchmarkQueryTrace struct{}

func (benchmarkQueryTrace) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if queries, ok := ctx.Value(benchmarkTraceKey{}).(*[]pgx.TraceQueryStartData); ok {
		data.Args = append([]any(nil), data.Args...)
		*queries = append(*queries, data)
	}
	return ctx
}
func (benchmarkQueryTrace) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}
