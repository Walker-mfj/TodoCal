package database

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strings"
	"testing"
	"time"
)

// The schema and fixtures live only inside a rolled-back transaction. This does
// not downgrade or reset any application's migration history.
func TestTaskInstantMigrationRecoversLegacyGap(t *testing.T) {
	connection := os.Getenv("NOTIFICATIONS_TEST_DATABASE_URL")
	if connection == "" {
		t.Skip("NOTIFICATIONS_TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, connection)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if !strings.HasSuffix(pool.Config().ConnConfig.Database, "_test") {
		t.Fatal("test database required")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	schema := pgx.Identifier{fmt.Sprintf("instant_migration_%d", time.Now().UnixNano())}.Sanitize()
	for _, q := range []string{"CREATE SCHEMA " + schema, "SET LOCAL search_path TO " + schema} {
		if _, err = tx.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	files, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if strings.HasSuffix(file.Name(), ".up.sql") && file.Name() < "000022" {
			raw, e := migrationFiles.ReadFile("migrations/" + file.Name())
			if e != nil {
				t.Fatal(e)
			}
			if _, e = tx.Exec(ctx, string(raw)); e != nil {
				t.Fatalf("%s: %v", file.Name(), e)
			}
		}
	}
	seed := `INSERT INTO users(id,email,password_hash) VALUES('00000000-0000-0000-0000-000000000001','migration@example.com','unused');
 INSERT INTO settings(user_id,timezone) VALUES('00000000-0000-0000-0000-000000000001','UTC');
 INSERT INTO tasks(user_id,id,title,scheduled_date,start_time,end_time,created_at,updated_at)
 VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','Legacy gap','2026-03-08','02:30','03:30',now(),now());
 INSERT INTO task_events(user_id,id,task_id,kind,occurred_at,local_date,timezone,after_state)
 VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','created',now(),'2026-03-08','UTC',
 '{"scheduledDate":"2026-03-08","startTime":"02:30","endTime":"03:30","revision":1}');
 UPDATE settings SET timezone='America/New_York';`
	if _, err = tx.Exec(ctx, seed); err != nil {
		t.Fatal(err)
	}
	raw, err := migrationFiles.ReadFile("migrations/000022_task_instants.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, string(raw)); err != nil {
		t.Fatal(err)
	}
	var start, end time.Time
	if err = tx.QueryRow(ctx, `SELECT scheduled_start_at,scheduled_end_at FROM tasks`).Scan(&start, &end); err != nil {
		t.Fatal(err)
	}
	if !start.Equal(time.Date(2026, 3, 8, 2, 30, 0, 0, time.UTC)) || end.Sub(start) != time.Hour {
		t.Fatal("lost recorded schedule", start, end)
	}
}
