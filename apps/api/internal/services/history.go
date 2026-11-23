package services

import (
	"context"
	"encoding/json"
	"time"

	"focuscalendar/internal/repository"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Explicit mutations adjust only this task's contribution, preserving other
// tasks' historical state and the original snapshot timezone.
func refreshHistorical(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, before *Task, after Task) error {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return err
	}
	dates := map[string]bool{}
	attributed := map[string]bool{}
	for _, t := range []*Task{before, &after} {
		if t != nil && t.ScheduledDate != nil {
			dates[*t.ScheduledDate] = true
		}
	}
	// An edit in another display zone must update the task's original snapshot,
	// not silently remove its contribution or move historical day attribution.
	rows, e := tx.Query(ctx, `SELECT date::text FROM daily_plan_entries WHERE user_id=$1 AND task_id=$2`, user, after.ID)
	if e != nil {
		return e
	}
	for rows.Next() {
		var date string
		if e = rows.Scan(&date); e != nil {
			rows.Close()
			return e
		}
		dates[date] = true
		attributed[date] = true
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	if before != nil && sameScheduledStart(*before, after) && len(attributed) > 0 {
		dates = attributed
	}
	for date := range dates {
		if date >= now.In(loc).Format("2006-01-02") {
			if !attributed[date] {
				continue
			}
			var finalized bool
			if err = repository.HistoricalSnapshotExists(ctx, tx, user, date, &finalized); err != nil {
				return err
			}
			if !finalized {
				continue
			}
		}
		_, err = repository.EnsureSnapshot(ctx, tx, user, date, zone, now)
		if err != nil {
			return err
		}
		snapshotZone := zone
		if err = tx.QueryRow(ctx, `SELECT COALESCE((SELECT task_state->>'timezone' FROM daily_plan_entries WHERE user_id=$1 AND date=$2 AND task_id=$3),timezone) FROM daily_snapshots WHERE user_id=$1 AND date=$2`, user, date, after.ID).Scan(&snapshotZone); err != nil {
			return err
		}
		if !attributed[date] {
			snapshotZone = zone
		}
		snapshotTask := projectTask(after, snapshotZone)
		_, err = repository.DeleteSnapshotEntry(ctx, tx, user, date, after.ID)
		if err != nil {
			return err
		}
		if snapshotTask.DeletedAt == nil && snapshotTask.ScheduledDate != nil && *snapshotTask.ScheduledDate == date {
			raw, e := json.Marshal(snapshotTask)
			if e != nil {
				return e
			}
			_, err = repository.InsertHistoricalEntry(ctx, tx, user, date, after.ID, raw, after.GroupID, snapshotZone)
			if err != nil {
				return err
			}
		}
		_, err = repository.RecountSnapshot(ctx, tx, user, date)
		if err != nil {
			return err
		}
	}
	return nil
}

func GetDeleted(ctx context.Context, tx pgx.Tx, user, id string) (Task, error) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return Task{}, Missing()
	}
	return repository.FindDeletedTask(ctx, tx, user, parsed.String())
}
func RestoreTask(ctx context.Context, tx pgx.Tx, user, zone, id string, now time.Time, revision int64) (Task, error) {
	old, err := GetDeleted(ctx, tx, user, id)
	if err != nil {
		return Task{}, err
	}
	if old.Revision != revision {
		return Task{}, Conflict()
	}
	t, err := repository.RestoreTask(ctx, tx, user, old.ID, now)
	if err != nil {
		return t, err
	}
	// Keep moved exceptions. Existing task identity also prevents regeneration.
	_, err = repository.DeleteTaskDeletionException(ctx, tx, user, old.ID)
	if err != nil {
		return t, err
	}
	return t, Event(ctx, tx, user, zone, "restored", now, &old, t)
}
