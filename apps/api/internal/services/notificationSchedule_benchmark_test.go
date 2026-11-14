package services

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"focuscalendar/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Opt-in destructive benchmark, isolated from application and integration DBs.
// Captures the exact production query with EXPLAIN (ANALYZE, BUFFERS), then
// measures warm executions. Run with -benchtime=10x -count=1 -v to retain plans.
func BenchmarkNotificationNextDue(b *testing.B) {
	url := os.Getenv("SCHEDULER_BENCHMARK_DATABASE_URL")
	if url == "" {
		b.Skip("SCHEDULER_BENCHMARK_DATABASE_URL required")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
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
				exec(`INSERT INTO users(id,email,password_hash) SELECT md5('user'||g)::uuid,'bench'||g||'@scheduler.test','test-only' FROM generate_series(1,100) g`)
				exec(`INSERT INTO settings(user_id) SELECT id FROM users`)
				exec(`INSERT INTO notification_preferences(user_id,task_start,deadline,focus_complete) SELECT id,true,true,true FROM users`)
				exec(`INSERT INTO auth_sessions(id,user_id,token_hash,csrf_hash,expires_at)
 SELECT id,id,id::text,'test-only',$1::timestamptz+interval '1 day' FROM users`, now)
				exec(`INSERT INTO push_subscriptions(id,user_id,session_id,endpoint,p256dh,auth,created_at)
 SELECT md5(u.id::text||g)::uuid,u.id,u.id,'https://example.test/'||u.id||'/'||g,'key','auth',$2::timestamptz-interval '2 days'
 FROM users u CROSS JOIN generate_series(1,$1::int) g`, devices, now)
				// Mix archived, completed, due, and future tasks; 100 accounts and multiple
				// devices exercise both candidate generation and the per-device anti-join.
				exec(`INSERT INTO tasks(user_id,id,title,scheduled_date,start_time,end_time,deadline,status,created_at,updated_at)
 SELECT md5('user'||((g-1)%100+1))::uuid,md5('task'||g)::uuid,'benchmark',
 $2::timestamptz::date+CASE WHEN g%4=0 THEN -30 WHEN g%4=1 THEN 0 ELSE g%30 END,
 '10:00'::time,'10:30'::time,$2::timestamptz+(g%60)*interval '1 minute',
 CASE WHEN g%10=0 THEN 'complete' ELSE 'incomplete' END,$2,$2 FROM generate_series(1,$1::int) g`, size, now)
				exec(`INSERT INTO notification_outbox(id,subscription_id,event_key,due_at,kind,next_attempt_at,finished_at,outcome)
 SELECT md5(s.id::text||c.event_key)::uuid,s.id,c.event_key,c.due_at,c.kind,$1,$1,'sent'
 FROM notification_candidates c JOIN push_subscriptions s ON s.user_id=c.user_id
 WHERE c.due_at BETWEEN $1::timestamptz-interval '10 minutes' AND $1 AND substring(s.id::text,1,1)<'8'`, now)
				for _, table := range []string{"tasks", "settings", "notification_preferences", "push_subscriptions", "auth_sessions", "notification_outbox", "focus_sessions"} {
					exec("ANALYZE " + table)
				}
				rows, err := pool.Query(ctx, "EXPLAIN (ANALYZE, BUFFERS) "+nextDueSQL(true), now)
				if err != nil {
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
				if err != nil {
					b.Fatal(err)
				}
				b.Logf("tasks=%d devices/account=%d\n%s", size, devices, plan.String())
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					var due *time.Time
					if err = pool.QueryRow(ctx, nextDueSQL(true), now).Scan(&due); err != nil {
						b.Fatal(err)
					}
				}
			})
		}
	}
}
