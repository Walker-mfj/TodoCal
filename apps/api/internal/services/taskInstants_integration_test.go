package services_test

import (
	"context"
	"encoding/json"
	"focuscalendar/internal/database"
	"focuscalendar/internal/dto"
	"focuscalendar/internal/services"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strings"
	"testing"
	"time"
)

func TestTaskInstantsTimezoneCalendarRecurrenceAndUndo(t *testing.T) {
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
	if err = database.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, "TRUNCATE users, auth_attempts CASCADE"); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2030, 4, 1, 12, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	auth := services.Auth{Pool: pool, Now: clock}
	session, err := auth.Register(ctx, services.Credentials{Email: "instants@example.com", Password: "correct horse battery", Timezone: "Asia/Tokyo"}, "instants-test")
	if err != nil {
		t.Fatal(err)
	}
	principal, err := auth.Authenticate(ctx, session.Token)
	if err != nil {
		t.Fatal(err)
	}
	run := func(fn func(pgx.Tx, string, time.Time) error) {
		t.Helper()
		if e := services.WithTx(ctx, pool, principal.ID, clock, fn); e != nil {
			t.Fatal(e)
		}
	}
	var task services.Task
	var series services.Series
	run(func(tx pgx.Tx, zone string, at time.Time) error {
		var input services.TaskInput
		_ = json.Unmarshal([]byte(`{"title":"Cross midnight after travel","scheduledDate":"2030-04-02","scheduledEndDate":"2030-04-02","startTime":"01:30","endTime":"03:00","deadline":"2030-04-01T19:00:00Z"}`), &input)
		task, err = services.CreateTask(ctx, tx, principal.ID, zone, at, input)
		if err != nil {
			return err
		}
		input.Title = "Daily fixed-zone"
		series, err = services.CreateSeries(ctx, tx, principal.ID, zone, at, services.SeriesInput{Task: input, Cadence: "daily"})
		return err
	})
	originalStart, originalEnd := *task.ScheduledStartAt, *task.ScheduledEndAt
	if originalEnd.Sub(originalStart) != 90*time.Minute {
		t.Fatal(task)
	}
	if _, err = pool.Exec(ctx, "INSERT INTO notification_preferences(user_id,task_start) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET task_start=true", principal.ID); err != nil {
		t.Fatal(err)
	}
	var originalDue time.Time
	var originalKey string
	if err = pool.QueryRow(ctx, "SELECT due_at,event_key FROM notification_candidates WHERE event_key LIKE 'start:'||$1::text||':%'", task.ID).Scan(&originalDue, &originalKey); err != nil {
		t.Fatal(err)
	}
	setZone := func(zone string, revision int) {
		t.Helper()
		run(func(tx pgx.Tx, old string, at time.Time) error {
			raw, _ := json.Marshal(map[string]any{"timezone": zone, "expectedRevision": revision})
			_, _, e := services.EditSettingsCommand(ctx, tx, principal, old, at, dto.Command(raw), services.Parameters{})
			return e
		})
	}
	setZone("Asia/Ho_Chi_Minh", 1)
	run(func(tx pgx.Tx, zone string, at time.Time) error {
		task, err = services.GetTask(ctx, tx, principal.ID, task.ID)
		if err != nil {
			return err
		}
		if *task.ScheduledDate != "2030-04-01" || *task.ScheduledEndDate != "2030-04-02" || *task.StartTime != "23:30" || *task.EndTime != "01:00" {
			t.Fatal(task)
		}
		input := task.TaskInput
		input.Title = "Content only"
		task, err = services.UpdateTask(ctx, tx, principal.ID, zone, at, task, input)
		return err
	})
	if !task.ScheduledStartAt.Equal(originalStart) || !task.ScheduledEndAt.Equal(originalEnd) {
		t.Fatal("editing moved instants")
	}
	var due time.Time
	var key string
	if err = pool.QueryRow(ctx, "SELECT due_at,event_key FROM notification_candidates WHERE event_key LIKE 'start:'||$1::text||':%'", task.ID).Scan(&due, &key); err != nil || !due.Equal(originalDue) || key != originalKey {
		t.Fatal("timezone changed reminder", due, key, err)
	}
	// Query only the second day: the overnight task still appears exactly once.
	run(func(tx pgx.Tx, zone string, at time.Time) error {
		out, e := services.CalendarCommand(ctx, tx, principal, zone, at, nil, services.Parameters{Query: services.Values{"from": {"2030-04-02"}, "to": {"2030-04-03"}}})
		if e != nil {
			return e
		}
		found := 0
		for _, v := range out.(map[string]any)["tasks"].([]services.Task) {
			if v.ID == task.ID {
				found++
			}
		}
		if found != 1 {
			t.Fatalf("overlapping task count: %d", found)
		}
		return nil
	})
	// A previously unmaterialized series date keeps Tokyo clocks after travel.
	run(func(tx pgx.Tx, zone string, at time.Time) error {
		return services.Materialize(ctx, tx, principal.ID, zone, "2030-04-10", "2030-04-11", at)
	})
	var start time.Time
	if err = pool.QueryRow(ctx, `SELECT scheduled_start_at FROM tasks WHERE user_id=$1 AND series_id=$2 AND original_occurrence_date='2030-04-10'`, principal.ID, series.ID).Scan(&start); err != nil || !start.Equal(time.Date(2030, 4, 9, 16, 30, 0, 0, time.UTC)) {
		t.Fatal("series timezone drift", start, err)
	}
	var undo string
	run(func(tx pgx.Tx, zone string, at time.Time) error {
		date, endDate, a, b := "2030-04-03", "2030-04-04", "23:00", "02:00"
		changed, e := services.Reschedule(ctx, tx, principal.ID, zone, task.ID, at, services.Schedule{ScheduledDate: &date, ScheduledEndDate: &endDate, StartTime: &a, EndTime: &b}, task.Revision)
		undo = changed.Undo.ID
		return e
	})
	setZone("Asia/Tokyo", 2)
	run(func(tx pgx.Tx, zone string, at time.Time) error {
		task, err = services.UndoSchedule(ctx, tx, principal.ID, zone, undo, at)
		return err
	})
	if !task.ScheduledStartAt.Equal(originalStart) || !task.ScheduledEndAt.Equal(originalEnd) {
		t.Fatal("undo lost original interval", task)
	}
	// Accepted history stays attributed to Tokyo April 2 even after the same
	// interval projects to Vietnam April 1, including content edits and restore.
	now = time.Date(2030, 4, 3, 12, 0, 0, 0, time.UTC)
	run(func(tx pgx.Tx, zone string, at time.Time) error { return nil })
	setZone("Asia/Ho_Chi_Minh", 3)
	run(func(tx pgx.Tx, zone string, at time.Time) error {
		old, e := services.GetTask(ctx, tx, principal.ID, task.ID)
		if e != nil {
			return e
		}
		in := old.TaskInput
		in.Title = "Historical content edit"
		task, e = services.UpdateTask(ctx, tx, principal.ID, zone, at, old, in)
		return e
	})
	assertAttribution := func() {
		t.Helper()
		var count int
		var date string
		e := pool.QueryRow(ctx, `SELECT count(*),min(date)::text FROM daily_plan_entries WHERE user_id=$1 AND task_id=$2`, principal.ID, task.ID).Scan(&count, &date)
		if e != nil || count != 1 || date != "2030-04-02" {
			t.Fatal("history moved or duplicated", count, date, e)
		}
	}
	assertAttribution()
	run(func(tx pgx.Tx, zone string, at time.Time) error {
		return services.DeleteTask(ctx, tx, principal.ID, zone, at, task)
	})
	run(func(tx pgx.Tx, zone string, at time.Time) error {
		var e error
		task, e = services.RestoreTask(ctx, tx, principal.ID, zone, task.ID, at, task.Revision+1)
		return e
	})
	assertAttribution()

}
