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

func Stop(ctx context.Context, tx pgx.Tx, user, zone, id string, now time.Time, revision int64) (any, error) {
	parsed, e := uuid.Parse(id)
	if e != nil {
		return nil, Missing()
	}
	id = parsed.String()
	var rev int64
	var stopped *string
	e = repository.ReadSeriesStopState(ctx, tx, user, id, &rev, &stopped)
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, Missing()
	}
	if e != nil {
		return nil, e
	}
	if rev != revision {
		return nil, Conflict()
	}
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return nil, e
	}
	today := now.In(loc).Format("2006-01-02")
	if stopped != nil {
		return map[string]any{"id": id, "revision": rev, "stoppedAfter": stopped}, nil
	}
	_, e = repository.StopSeries(ctx, tx, user, id, today)
	if e != nil {
		return nil, e
	}
	affected, e := repository.ListStoppableTasks(ctx, tx, user, id, today)
	if e != nil {
		return nil, e
	}
	for _, t := range affected {
		if e = DeleteTask(ctx, tx, user, zone, now, t); e != nil {
			return nil, e
		}
	}
	undo := map[string]int64{}
	for _, t := range affected {
		undo[t.ID] = t.Revision + 1
	}
	raw, e := json.Marshal(undo)
	if e != nil {
		return nil, e
	}
	_, e = repository.SaveSeriesStopUndo(ctx, tx, user, id, raw)
	if e != nil {
		return nil, e
	}
	return map[string]any{"id": id, "revision": rev + 1, "stoppedAfter": today}, nil
}

// RestoreStop checks the series and every cancelled occurrence before restoring
// anything; the surrounding account transaction makes failures atomic.
func RestoreStop(ctx context.Context, tx pgx.Tx, user, zone, id string, now time.Time, revision int64) (Series, error) {
	sr, err := GetSeries(ctx, tx, user, id)
	if err != nil {
		return sr, err
	}
	if sr.Revision != revision {
		return sr, Conflict()
	}
	var raw []byte
	err = repository.ReadSeriesStopUndo(ctx, tx, user, sr.ID, &raw)
	if err != nil {
		return sr, err
	}
	if raw == nil {
		return sr, Conflict()
	}
	var envelope tailUndo
	_ = json.Unmarshal(raw, &envelope)
	var affected map[string]int64
	if envelope.Kind == "following" {
		affected = envelope.Tasks
	} else if err = json.Unmarshal(raw, &affected); err != nil {
		return sr, err
	}
	for taskID, rev := range affected {
		t, e := GetDeleted(ctx, tx, user, taskID)
		if e != nil || t.Revision != rev {
			return sr, Conflict()
		}
	}
	for taskID, rev := range affected {
		if _, err = RestoreTask(ctx, tx, user, zone, taskID, now, rev); err != nil {
			return sr, err
		}
	}
	if envelope.Kind == "following" {
		_, err = tx.Exec(ctx, `UPDATE recurrence_series SET original_cutoff=$3,stop_undo=NULL,revision=revision+1 WHERE user_id=$1 AND id=$2`, user, sr.ID, envelope.PreviousCutoff)
	} else {
		_, err = repository.ClearSeriesStop(ctx, tx, user, sr.ID)
	}
	if err != nil {
		return sr, err
	}
	return GetSeries(ctx, tx, user, sr.ID)
}
