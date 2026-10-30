// Planning finalizes local days under the same lock as account commands.
package services

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"time"

	"focuscalendar/internal/database"
	"focuscalendar/internal/localdate"
	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Entry = models.Entry
type Day = models.Day

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
func enrich(ctx context.Context, tx pgx.Tx, user string, t Task) (Entry, error) {
	entry := Entry{Task: t}
	if t.GroupID == nil {
		return entry, nil
	}
	e := repository.ReadGroupPresentation(ctx, tx, user, t.GroupID, &entry.GroupName, &entry.GroupColor)
	if errors.Is(e, pgx.ErrNoRows) {
		e = nil
	}
	return entry, e
}
func liveEntries(ctx context.Context, tx pgx.Tx, user, date string) ([]Entry, error) {
	list, e := repository.ListScheduledTasks(ctx, tx, user, date)
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
	list, e := repository.ListHistoricalTaskStates(ctx, tx, user, date, cutoff)
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
	if e := repository.SnapshotExists(ctx, tx, user, date, &exists); e != nil {
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

// Settle performs at most 31 calendar days per transaction. False means the
// caller must commit this batch and repeat before allowing the user's command.
func Settle(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time) (bool, error) {
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return false, e
	}
	today := now.In(loc).Format("2006-01-02")
	var through *string
	e = repository.ReadPlanningCursor(ctx, tx, user, &through)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return false, e
	}
	var next *string
	if through != nil {
		v := localdate.Add(*through, 1)
		next = &v
	}
	var first *string
	e = repository.FindFirstUnsettledDate(ctx, tx, user, today, next, &first)
	if e != nil {
		return false, e
	}
	end := today
	if first != nil {
		if limit := localdate.Add(*first, 31); limit < end {
			end = limit
		}
		if e = Materialize(ctx, tx, user, zone, *first, end, now); e != nil {
			return false, e
		}
		for date := *first; date < end; date = localdate.Add(date, 1) {
			if e = Finalize(ctx, tx, user, zone, date, now); e != nil {
				return false, e
			}
		}
	}
	_, e = repository.AdvancePlanningCursor(ctx, tx, user, localdate.Add(end, -1))
	if e != nil {
		return false, e
	}
	if end < today {
		return false, nil
	}
	return true, Materialize(ctx, tx, user, zone, today, localdate.Add(today, 1), now)
}
func WithTx(ctx context.Context, pool *pgxpool.Pool, user string, now func() time.Time, fn func(pgx.Tx, string, time.Time) error) error {
	for {
		if e := ctx.Err(); e != nil {
			return e
		}
		done := false
		e := database.WithTx(ctx, pool, user, func(tx pgx.Tx, zone string) error {
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
	e := repository.ReadSnapshotSummary(ctx, tx, user, date, &out)
	if e == nil {
		out.Finalized = true
		out.Entries, e = repository.ListSnapshotEntries(ctx, tx, user, date)
		if e != nil {
			return out, e
		}
		// Sessions evolve independently from the saved daily plan. Keep the
		// snapshot's planned content while exposing current focus and revision.
		for i := range out.Entries {
			current, err := GetTask(ctx, tx, user, out.Entries[i].Task.ID)
			if err != nil {
				var fault *Fault
				if errors.As(err, &fault) && fault.Code == "not_found" {
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
	_, e = repository.ClearInvalidTimeExceptions(ctx, tx, user, to)
	if e != nil {
		return e
	}

	if from >= to {
		return nil
	}
	if e = Materialize(ctx, tx, user, oldZone, from, to, now); e != nil {
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
