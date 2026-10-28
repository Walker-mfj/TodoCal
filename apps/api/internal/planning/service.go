// Package planning finalizes local days under the same lock as account commands.
package planning

import (
	"context"
	"encoding/json"
	"errors"
	"focuscalendar/internal/account"
	"focuscalendar/internal/localdate"
	"focuscalendar/internal/recurrence"
	"focuscalendar/internal/tasks"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"math"
	"time"
)

type Entry struct {
	Task       tasks.Task `json:"task"`
	GroupName  *string    `json:"groupName"`
	GroupColor *string    `json:"groupColor"`
}
type Day struct {
	Date       string   `json:"date"`
	Timezone   string   `json:"timezone"`
	Planned    int      `json:"planned"`
	Completed  int      `json:"completed"`
	Percentage *float64 `json:"percentage"`
	Finalized  bool     `json:"finalized"`
	Entries    []Entry  `json:"entries"`
}

func percentage(planned, completed int) *float64 {
	if planned == 0 {
		return nil
	}
	v := math.Round(float64(completed)*1000/float64(planned)) / 10
	if completed < planned && v >= 100 {
		v = 99.9
	}
	return &v
}
func enrich(ctx context.Context, tx pgx.Tx, user string, t tasks.Task) (Entry, error) {
	entry := Entry{Task: t}
	if t.GroupID == nil {
		return entry, nil
	}
	e := tx.QueryRow(ctx, `SELECT name,color FROM groups WHERE user_id=$1 AND id=$2`, user, t.GroupID).Scan(&entry.GroupName, &entry.GroupColor)
	if errors.Is(e, pgx.ErrNoRows) {
		e = nil
	}
	return entry, e
}
func liveEntries(ctx context.Context, tx pgx.Tx, user, date string) ([]Entry, error) {
	rows, e := tx.Query(ctx, `SELECT `+tasks.Columns+` FROM tasks WHERE user_id=$1 AND scheduled_date=$2 AND deleted_at IS NULL ORDER BY start_time NULLS FIRST,id`, user, date)
	if e != nil {
		return nil, e
	}
	list := []tasks.Task{}
	for rows.Next() {
		t, err := tasks.Scan(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		list = append(list, t)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	entries := []Entry{}
	for _, t := range list {
		v, err := enrich(ctx, tx, user, t)
		if err != nil {
			return nil, err
		}
		entries = append(entries, v)
	}
	return entries, nil
}
func endedEntries(ctx context.Context, tx pgx.Tx, user, date string, cutoff time.Time) ([]Entry, error) {
	rows, e := tx.Query(ctx, `WITH latest AS (SELECT DISTINCT ON(task_id) task_id,kind,after_state FROM task_events WHERE user_id=$1 AND (occurred_at<$3 OR historical_adjustment) ORDER BY task_id,occurred_at DESC,(after_state->>'revision')::bigint DESC) SELECT after_state FROM latest WHERE kind<>'deleted' AND after_state->>'scheduledDate'=$2 ORDER BY after_state->>'startTime' NULLS FIRST,task_id`, user, date, cutoff)
	if e != nil {
		return nil, e
	}
	list := []tasks.Task{}
	for rows.Next() {
		var raw []byte
		if e = rows.Scan(&raw); e != nil {
			rows.Close()
			return nil, e
		}
		var t tasks.Task
		if e = json.Unmarshal(raw, &t); e != nil {
			rows.Close()
			return nil, e
		}
		list = append(list, t)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	entries := []Entry{}
	for _, t := range list {
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
	if e := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date=$2)`, user, date).Scan(&exists); e != nil {
		return e
	}
	if exists {
		return nil
	}
	entries, e := endedEntries(ctx, tx, user, date, cutoff)
	if e != nil {
		return e
	}
	if len(entries) == 0 {
		var touched bool
		e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM task_events WHERE user_id=$1 AND after_state->>'scheduledDate'=$2) OR EXISTS(SELECT 1 FROM recurrence_exceptions WHERE user_id=$1 AND original_occurrence_date=$2::date)`, user, date).Scan(&touched)
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
	_, e = tx.Exec(ctx, `INSERT INTO daily_snapshots(user_id,date,timezone,planned,completed,finalized_at) VALUES($1,$2,$3,$4,$5,$6)`, user, date, zone, len(entries), complete, now)
	if e != nil {
		return e
	}
	for _, entry := range entries {
		raw, err := json.Marshal(entry)
		if err != nil {
			return err
		}
		_, e = tx.Exec(ctx, `INSERT INTO daily_plan_entries(user_id,date,task_id,task_state) VALUES($1,$2,$3,$4)`, user, date, entry.Task.ID, raw)
		if e != nil {
			return e
		}
	}
	return nil
}

// Settle performs at most 31 calendar days per transaction. False means the
// caller must commit this batch and repeat before allowing the user's command.
func Settle(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time) (bool, error) {
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return false, e
	}
	today := now.In(loc).Format("2006-01-02")
	var through *string
	e = tx.QueryRow(ctx, `SELECT caught_up_through::text FROM planning_state WHERE user_id=$1`, user).Scan(&through)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return false, e
	}
	var next *string
	if through != nil {
		v := localdate.Add(*through, 1)
		next = &v
	}
	var first *string
	e = tx.QueryRow(ctx, `SELECT min(d)::text FROM (
 SELECT (after_state->>'scheduledDate')::date AS d FROM task_events WHERE user_id=$1 AND after_state->>'scheduledDate' IS NOT NULL
 UNION SELECT GREATEST(start_date,COALESCE($3::date,start_date)) FROM recurrence_series WHERE user_id=$1 AND (end_date IS NULL OR end_date>=GREATEST(start_date,COALESCE($3::date,start_date))) AND (stopped_after IS NULL OR stopped_after>=GREATEST(start_date,COALESCE($3::date,start_date)))
 ) candidates WHERE d<$2::date AND NOT EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date=d)`, user, today, next).Scan(&first)
	if e != nil {
		return false, e
	}
	end := today
	if first != nil {
		if limit := localdate.Add(*first, 31); limit < end {
			end = limit
		}
		if e = recurrence.Materialize(ctx, tx, user, zone, *first, end, now); e != nil {
			return false, e
		}
		for date := *first; date < end; date = localdate.Add(date, 1) {
			if e = Finalize(ctx, tx, user, zone, date, now); e != nil {
				return false, e
			}
		}
	}
	_, e = tx.Exec(ctx, `INSERT INTO planning_state(user_id,caught_up_through) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET caught_up_through=GREATEST(planning_state.caught_up_through,EXCLUDED.caught_up_through)`, user, localdate.Add(end, -1))
	if e != nil {
		return false, e
	}
	if end < today {
		return false, nil
	}
	return true, recurrence.Materialize(ctx, tx, user, zone, today, localdate.Add(today, 1), now)
}
func WithTx(ctx context.Context, pool *pgxpool.Pool, user string, now func() time.Time, fn func(pgx.Tx, string, time.Time) error) error {
	for {
		if e := ctx.Err(); e != nil {
			return e
		}
		done := false
		e := account.WithTx(ctx, pool, user, func(tx pgx.Tx, zone string) error {
			stamp := now().UTC()
			var err error
			done, err = Settle(ctx, tx, user, zone, stamp)
			if err != nil {
				return err
			}
			if !done {
				return nil
			}
			return fn(tx, zone, stamp)
		})
		if e != nil {
			return e
		}
		if done {
			return nil
		}
	}
}
func DayReport(ctx context.Context, tx pgx.Tx, user, zone, date string, now time.Time) (Day, error) {
	out := Day{Date: date, Timezone: zone, Entries: []Entry{}}
	e := tx.QueryRow(ctx, `SELECT timezone,planned,completed FROM daily_snapshots WHERE user_id=$1 AND date=$2`, user, date).Scan(&out.Timezone, &out.Planned, &out.Completed)
	if e == nil {
		out.Finalized = true
		rows, err := tx.Query(ctx, `SELECT task_state FROM daily_plan_entries WHERE user_id=$1 AND date=$2 ORDER BY task_state->'task'->>'startTime' NULLS FIRST,task_id`, user, date)
		if err != nil {
			return out, err
		}
		defer rows.Close()
		for rows.Next() {
			var raw []byte
			if e = rows.Scan(&raw); e != nil {
				return out, e
			}
			var entry Entry
			if e = json.Unmarshal(raw, &entry); e != nil {
				return out, e
			}
			out.Entries = append(out.Entries, entry)
		}
		if e = rows.Err(); e != nil {
			return out, e
		}
		rows.Close()
		// Sessions evolve independently from the saved daily plan. Keep the
		// snapshot's planned content while exposing current focus and revision.
		for i := range out.Entries {
			current, err := tasks.Get(ctx, tx, user, out.Entries[i].Task.ID)
			if err != nil {
				var fault *tasks.Fault
				if errors.As(err, &fault) && fault.Status == 404 {
					continue
				}
				return out, err
			}
			if out.Entries[i].Task.Status == "complete" {
				out.Entries[i].Task.CompletedAt = current.CompletedAt
			}
			out.Entries[i].Task.ActualFocusSeconds = current.ActualFocusSeconds
			out.Entries[i].Task.FocusProgress = current.FocusProgress
			out.Entries[i].Task.RecurrenceCadence = current.RecurrenceCadence
			out.Entries[i].Task.RecurrenceIntervalDays = current.RecurrenceIntervalDays
			out.Entries[i].Task.Revision = current.Revision
		}
		out.Percentage = percentage(out.Planned, out.Completed)
		return out, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return out, e
	}
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return out, e
	}
	today := now.In(loc).Format("2006-01-02")
	if date < today {
		out.Finalized = true
		return out, nil
	}
	out.Entries, e = liveEntries(ctx, tx, user, date)
	if e != nil {
		return out, e
	}
	out.Planned = len(out.Entries)
	for _, entry := range out.Entries {
		if entry.Task.Status == "complete" {
			out.Completed++
		}
	}
	if date == today {
		out.Percentage = percentage(out.Planned, out.Completed)
	}
	return out, nil
}

// BeforeZoneChange seals dates crossed by a forward time-zone jump using the
// states already accepted under the old zone. Ordinary next-midnight cutoff
// would otherwise erase tasks created after that retroactive boundary.
func BeforeZoneChange(ctx context.Context, tx pgx.Tx, user, oldZone, newZone string, now time.Time) error {
	oldLoc, e := time.LoadLocation(oldZone)
	if e != nil {
		return e
	}
	newLoc, e := time.LoadLocation(newZone)
	if e != nil {
		return e
	}
	from, to := now.In(oldLoc).Format("2006-01-02"), now.In(newLoc).Format("2006-01-02")
	// Future gap exceptions are predictions under the previous zone, unlike
	// explicit user cancellations. Re-evaluate them without touching history.
	_, e = tx.Exec(ctx, `DELETE FROM recurrence_exceptions e WHERE e.user_id=$1 AND e.reason='invalid_local_time' AND e.original_occurrence_date >= $2::date AND NOT EXISTS(SELECT 1 FROM daily_snapshots s WHERE s.user_id=e.user_id AND s.date=e.original_occurrence_date)`, user, to)
	if e != nil {
		return e
	}

	if from >= to {
		return nil
	}
	if e = recurrence.Materialize(ctx, tx, user, oldZone, from, to, now); e != nil {
		return e
	}
	for date := from; date < to; date = localdate.Add(date, 1) {
		if e = finalizeAt(ctx, tx, user, oldZone, date, now, now.Add(time.Microsecond)); e != nil {
			return e
		}
	}
	return nil
}

// DayAt reconstructs a partial historical comparison without changing its snapshot.
func DayAt(ctx context.Context, tx pgx.Tx, user, zone, date string, cutoff time.Time) (Day, error) {
	out := Day{Date: date, Timezone: zone, Finalized: true, Entries: []Entry{}}
	entries, e := endedEntries(ctx, tx, user, date, cutoff.Add(time.Microsecond))
	if e != nil {
		return out, e
	}
	out.Entries = entries
	out.Planned = len(entries)
	for _, entry := range entries {
		if entry.Task.Status == "complete" {
			out.Completed++
		}
	}
	out.Percentage = percentage(out.Planned, out.Completed)
	return out, nil
}
