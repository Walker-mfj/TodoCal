package services

import (
	"context"
	"encoding/json"
	"time"

	"focuscalendar/internal/localdate"
	"focuscalendar/internal/repository"

	"github.com/jackc/pgx/v5"
)

func endedEntries(ctx context.Context, tx pgx.Tx, user, zone, date string, cutoff time.Time) ([]Entry, error) {
	list, e := repository.ListHistoricalTaskStates(ctx, tx, user, date, cutoff, zone)
	if e != nil {
		return nil, e
	}
	entries := []Entry{}
	for _, t := range list {
		t = projectTask(t, zone)
		v, err := enrich(ctx, tx, user, t)
		if err != nil {
			return nil, err
		}
		entries = append(entries, v)
	}
	return entries, nil
}

func Finalize(ctx context.Context, tx pgx.Tx, user, zone, date string, now time.Time) error {
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return e
	}
	return finalizeAt(ctx, tx, user, zone, date, now, localdate.Boundary(localdate.Add(date, 1), loc))
}

func finalizeAt(ctx context.Context, tx pgx.Tx, user, zone, date string, now, cutoff time.Time) error {
	var exists bool
	if e := repository.SnapshotExists(ctx, tx, user, date, &exists); e != nil {
		return e
	}
	if exists {
		return supplementSnapshot(ctx, tx, user, zone, date)
	}
	entries, e := endedEntries(ctx, tx, user, zone, date, cutoff)
	if e != nil {
		return e
	}
	if len(entries) == 0 {
		var touched bool
		e = repository.DayHasHistory(ctx, tx, user, date, &touched)
		if e != nil {
			return e
		}
		if !touched {
			return nil
		}
	}
	complete := 0
	for _, entry := range entries {
		if entry.Task.Status == "complete" {
			complete++
		}
	}
	_, e = repository.InsertSnapshot(ctx, tx, user, date, zone, len(entries), complete, now)
	if e != nil {
		return e
	}
	for _, entry := range entries {
		raw, err := json.Marshal(entry)
		if err != nil {
			return err
		}
		_, e = repository.InsertSnapshotEntry(ctx, tx, user, date, entry.Task.ID, raw)
		if e != nil {
			return e
		}
	}
	return nil
}

// Add only previously unattributed contributions; accepted entry payloads stay
// intact, including when a forward zone jump seals a reopened date early.
func supplementSnapshot(ctx context.Context, tx pgx.Tx, user, zone, date string) error {
	tasks, err := repository.ListUnattributedTasks(ctx, tx, user, date)
	if err != nil {
		return err
	}
	changed := false
	for _, task := range tasks {
		entry, err := enrich(ctx, tx, user, projectTask(task, zone))
		if err != nil {
			return err
		}
		entry.Timezone = zone
		raw, err := json.Marshal(entry)
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `INSERT INTO daily_plan_entries(user_id,date,task_id,task_state) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, user, date, entry.Task.ID, raw)
		if err != nil {
			return err
		}
		changed = changed || tag.RowsAffected() > 0
	}
	if changed {
		_, err = repository.RecountSnapshot(ctx, tx, user, date)
	}
	return err
}
