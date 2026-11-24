package controllers

import (
	"context"
	"fmt"
	"focuscalendar/internal/services"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"testing"
	"time"
)

func TestForwardZoneChangeDoesNotHideRecurringCatchup(t *testing.T) {
	s, pool := testServer(t)
	now := time.Date(2030, 12, 1, 23, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "forward-catchup@example.com")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "UTC", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": map[string]any{"title": "Daily", "scheduledDate": "2030-12-01"}, "cadence": "daily"}, c, csrf, uuid.NewString()), 201)
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Tokyo", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	var user, cursor string
	var snapshot bool
	if err := pool.QueryRow(context.Background(), `SELECT u.id,p.caught_up_through::text,EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=u.id AND date='2030-12-01') FROM users u JOIN planning_state p ON p.user_id=u.id WHERE email='forward-catchup@example.com'`).Scan(&user, &cursor, &snapshot); err != nil {
		t.Fatal(err)
	}
	if cursor != "2030-11-30" || !snapshot {
		t.Fatalf("unexpected fixture: cursor=%s snapshot=%v", cursor, snapshot)
	}
	now = now.AddDate(0, 0, 40)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	batches := 0
	for i := 0; i < 2; i++ {
		err := services.WithTx(ctx, pool, user, func() time.Time { batches++; return now }, func(tx pgx.Tx, zone string, at time.Time) error {
			for _, date := range []string{"2030-12-01", "2030-12-02", "2031-01-05"} {
				day, err := services.DayReport(ctx, tx, user, zone, date, at)
				if err != nil {
					return err
				}
				if day.Planned != 1 || len(day.Entries) != 1 {
					return fmt.Errorf("lost recurring day %s: %+v", date, day)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if batches != 3 {
		t.Fatalf("expected two catch-up batches plus repeat; got %d", batches)
	}
}

func TestFollowingRuleRestorePreservesSeriesInstants(t *testing.T) {
	for _, overnight := range []bool{false, true} {
		t.Run(fmt.Sprint(overnight), func(t *testing.T) {
			s, _ := testServer(t)
			s.now = func() time.Time { return time.Date(2030, 12, 1, 0, 0, 0, 0, time.UTC) }
			c, csrf := register(t, s, "restore-zone@example.com")
			object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Tokyo", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
			input := map[string]any{"title": "Pinned", "scheduledDate": "2030-12-03", "startTime": "01:30", "endTime": "02:00"}
			if overnight {
				input["startTime"] = "23:30"
				input["endTime"] = "01:00"
				input["scheduledEndDate"] = "2030-12-04"
			}
			object(t, command(s, "POST", "/api/v1/series", map[string]any{"task": input, "cadence": "daily"}, c, csrf, uuid.NewString()), 201)
			items := calendar(t, s, c, "2030-12-03", "2030-12-07")["tasks"].([]any)
			selected := items[0].(map[string]any)
			original := items[1].(map[string]any)
			object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Ho_Chi_Minh", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
			for _, rule := range []map[string]any{{"cadence": "interval", "intervalDays": 2, "endDate": nil}, {"cadence": "daily", "intervalDays": 1, "endDate": nil}} {
				selected = object(t, command(s, "PATCH", "/api/v1/tasks/"+selected["id"].(string), map[string]any{"scope": "following", "expectedRevision": selected["revision"], "expectedSeriesRevision": 1, "recurrence": rule}, c, csrf, uuid.NewString()), 200)
				if rule["cadence"] == "interval" {
					object(t, req(s, "GET", "/api/v1/tasks/"+original["id"].(string), nil, c, ""), 404)
				}
			}
			restored := object(t, req(s, "GET", "/api/v1/tasks/"+original["id"].(string), nil, c, ""), 200)
			for _, field := range []string{"id", "scheduledStartAt", "scheduledEndAt"} {
				if restored[field] != original[field] {
					t.Fatalf("restored %s changed: before=%v after=%v", field, original[field], restored[field])
				}
			}
		})
	}
}

func TestComparisonRespectsSupplementalEntryTimezone(t *testing.T) {
	s, pool := testServer(t)
	now := time.Date(2030, 12, 1, 0, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	c, csrf := register(t, s, "comparison-zones@example.com")
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Tokyo", "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "A", "scheduledDate": "2030-12-01", "startTime": "09:00", "endTime": "10:00"}, c, csrf, uuid.NewString()), 201)
	b := object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "B", "scheduledDate": "2030-12-02", "startTime": "01:30", "endTime": "02:00"}, c, csrf, uuid.NewString()), 201)
	now = time.Date(2030, 12, 1, 15, 10, 0, 0, time.UTC)
	renewTestSession(t, s, c, &csrf)
	object(t, command(s, "PATCH", "/api/v1/settings", map[string]any{"timezone": "Asia/Ho_Chi_Minh", "expectedRevision": 2}, c, csrf, uuid.NewString()), 200)
	now = time.Date(2030, 12, 1, 16, 40, 0, 0, time.UTC)
	renewTestSession(t, s, c, &csrf)
	object(t, command(s, "POST", "/api/v1/tasks/"+b["id"].(string)+"/completion", map[string]any{"complete": true, "expectedRevision": 1}, c, csrf, uuid.NewString()), 200)
	now = time.Date(2030, 12, 1, 16, 50, 0, 0, time.UTC)
	object(t, command(s, "POST", "/api/v1/tasks", map[string]any{"title": "After cutoff", "scheduledDate": "2030-12-01", "startTime": "23:55", "endTime": "23:59"}, c, csrf, uuid.NewString()), 201)
	now = time.Date(2030, 12, 1, 18, 0, 0, 0, time.UTC)
	renewTestSession(t, s, c, &csrf)
	full := calendar(t, s, c, "2030-12-01", "2030-12-02")["days"].([]any)[0].(map[string]any)
	if full["planned"] != float64(3) {
		t.Fatal(full)
	}
	var user string
	if err := pool.QueryRow(context.Background(), `SELECT user_id FROM tasks WHERE id=$1`, b["id"]).Scan(&user); err != nil {
		t.Fatal(err)
	}
	for _, minute := range []int{30, 45} {
		err := services.WithTx(context.Background(), pool, user, s.now, func(tx pgx.Tx, zone string, at time.Time) error {
			day, err := services.DayAt(context.Background(), tx, user, "Asia/Tokyo", "2030-12-01", time.Date(2030, 12, 1, 16, minute, 0, 0, time.UTC))
			if err != nil {
				return err
			}
			completed := 0
			if minute == 45 {
				completed = 1
			}
			if day.Planned != 2 || day.Completed != completed || day.Percentage == nil || *day.Percentage != float64(completed*50) {
				return fmt.Errorf("incorrect comparison: %+v", day)
			}
			for _, entry := range day.Entries {
				if entry.Task.ID == b["id"] && (entry.Timezone != "Asia/Ho_Chi_Minh" || *entry.Task.StartTime != "23:30") {
					return fmt.Errorf("incorrect entry zone: %+v", entry)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}
