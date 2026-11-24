package services

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"focuscalendar/internal/repository"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func Event(ctx context.Context, tx pgx.Tx, user, zone, kind string, now time.Time, before *Task, after Task) error {
	return recordTaskEvent(ctx, tx, user, zone, kind, now, before, after, true)
}

// Automatic lazy materialization only journals the occurrence. Settlement must
// collect the complete day's states before creating its snapshot.
func recordTaskEvent(ctx context.Context, tx pgx.Tx, user, zone, kind string, now time.Time, before *Task, after Task, adjustHistory bool) error {
	var attribution map[string]string
	var attributionErr error
	if kind == "deleted" {
		attribution, attributionErr = deletionAttribution(ctx, tx, user, after.ID)
	} else if kind == "restored" && before != nil && sameScheduledStart(*before, after) {
		attribution, attributionErr = restoredAttribution(ctx, tx, user, *before)
	}
	if attributionErr != nil {
		return attributionErr
	}
	if before != nil {
		var savedZone, savedDate string
		e := tx.QueryRow(ctx, `SELECT COALESCE(p.task_state->>'timezone',s.timezone),p.date::text FROM daily_plan_entries p JOIN daily_snapshots s ON s.user_id=p.user_id AND s.date=p.date WHERE p.user_id=$1 AND p.task_id=$2 ORDER BY p.date DESC LIMIT 1`, user, after.ID).Scan(&savedZone, &savedDate)
		if e != nil && !errors.Is(e, pgx.ErrNoRows) {
			return e
		}
		if e == nil {
			projected := projectTask(after, savedZone)
			if sameScheduledStart(*before, after) || (projected.ScheduledDate != nil && *projected.ScheduledDate == savedDate) {
				zone = savedZone
			}
		} else if before.DeletedAt != nil && sameScheduledStart(*before, after) {
			// A deletion removed its plan entry, but the journal still records
			// that entry's original zone for a later restore.
			e = tx.QueryRow(ctx, `SELECT timezone FROM task_events WHERE user_id=$1 AND task_id=$2 AND kind='deleted' ORDER BY occurred_at DESC,(after_state->>'revision')::bigint DESC LIMIT 1`, user, after.ID).Scan(&savedZone)
			if e != nil && !errors.Is(e, pgx.ErrNoRows) {
				return e
			}
			if e == nil {
				zone = savedZone
			}
		}
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return err
	}
	after = projectTask(after, zone)
	if before != nil {
		projected := projectTask(*before, zone)
		before = &projected
	}
	var old []byte
	if before != nil {
		old, err = json.Marshal(before)
		if err != nil {
			return err
		}
	}
	next, err := json.Marshal(deletionState{Task: after, HistoricalAttribution: attribution})
	if err != nil {
		return err
	}
	historical := len(attribution) > 0 || (after.ScheduledDate != nil && *after.ScheduledDate < now.In(loc).Format("2006-01-02"))
	if before != nil && before.ScheduledDate != nil && *before.ScheduledDate < now.In(loc).Format("2006-01-02") {
		historical = true
	}
	_, err = repository.InsertTaskEvent(ctx, tx, user, uuid.NewString(), after.ID, kind, now, now.In(loc).Format("2006-01-02"), zone, old, next, adjustHistory && historical && kind != "group_cleared" && kind != "series_reparented")
	if err != nil {
		return err
	}
	if !adjustHistory || kind == "group_cleared" || kind == "series_reparented" {
		return nil
	}
	return refreshHistorical(ctx, tx, user, zone, now, before, after, attribution)
}

func Exception(ctx context.Context, tx pgx.Tx, user string, t Task, reason string, now time.Time) error {
	if t.SeriesID == nil {
		return nil
	}
	_, e := repository.UpsertRecurrenceException(ctx, tx, user, t.SeriesID, t.OriginalOccurrenceDate, t.ID, reason, now)
	return e
}
