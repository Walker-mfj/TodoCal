package services

import (
	"context"
	"encoding/json"
	"time"

	"focuscalendar/internal/repository"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func Event(ctx context.Context, tx pgx.Tx, user, zone, kind string, now time.Time, before *Task, after Task) error {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return err
	}
	var old []byte
	if before != nil {
		old, err = json.Marshal(before)
		if err != nil {
			return err
		}
	}
	next, err := json.Marshal(after)
	if err != nil {
		return err
	}
	historical := after.ScheduledDate != nil && *after.ScheduledDate < now.In(loc).Format("2006-01-02")
	if before != nil && before.ScheduledDate != nil && *before.ScheduledDate < now.In(loc).Format("2006-01-02") {
		historical = true
	}
	_, err = repository.InsertTaskEvent(ctx, tx, user, uuid.NewString(), after.ID, kind, now, now.In(loc).Format("2006-01-02"), zone, old, next, historical && kind != "group_cleared" && kind != "series_reparented")
	if err != nil {
		return err
	}
	if kind == "group_cleared" || kind == "series_reparented" {
		return nil
	}
	return refreshHistorical(ctx, tx, user, zone, now, before, after)
}

func Exception(ctx context.Context, tx pgx.Tx, user string, t Task, reason string, now time.Time) error {
	if t.SeriesID == nil {
		return nil
	}
	_, e := repository.UpsertRecurrenceException(ctx, tx, user, t.SeriesID, t.OriginalOccurrenceDate, t.ID, reason, now)
	return e
}
