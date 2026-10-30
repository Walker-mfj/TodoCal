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
	for _, t := range []*Task{before, &after} {
		if t != nil && t.ScheduledDate != nil {
			dates[*t.ScheduledDate] = true
		}
	}
	for date := range dates {
		if date >= now.In(loc).Format("2006-01-02") {
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
		_, err = repository.DeleteSnapshotEntry(ctx, tx, user, date, after.ID)
		if err != nil {
			return err
		}
		if after.DeletedAt == nil && after.ScheduledDate != nil && *after.ScheduledDate == date {
			raw, e := json.Marshal(after)
			if e != nil {
				return e
			}
			_, err = repository.InsertHistoricalEntry(ctx, tx, user, date, after.ID, raw, after.GroupID)
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
