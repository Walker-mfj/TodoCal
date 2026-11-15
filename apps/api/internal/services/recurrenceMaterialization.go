package services

import (
	"context"
	"time"

	"focuscalendar/internal/localdate"
	"focuscalendar/internal/repository"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func Materialize(ctx context.Context, tx pgx.Tx, user, zone, from, to string, now time.Time, explicitSeries ...string) error {
	return materializeSelected(ctx, tx, user, zone, from, to, now, "", explicitSeries...)
}

// selected restricts the scheduler batch; explicitSeries retains the separate
// user-command permission to materialize against a finalized snapshot.
func materializeSelected(ctx context.Context, tx pgx.Tx, user, zone, from, to string, now time.Time, selected string, explicitSeries ...string) error {
	explicit := ""
	if len(explicitSeries) > 0 {
		explicit = explicitSeries[0]
	}
	if _, e := localdate.Parse(from); e != nil {
		return Invalid("Invalid range start")
	}
	if _, e := localdate.Parse(to); e != nil {
		return Invalid("Invalid range end")
	}
	if n := localdate.Days(from, to); n < 1 || n > 93 {
		return Invalid("Calendar range must be 1–93 days")
	}
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return e
	}
	all, e := repository.ListMaterializableSeries(ctx, tx, user, from, to, selected)
	if e != nil {
		return e
	}
	for _, sr := range all {
		for date := from; date < to; date = localdate.Add(date, 1) {
			original := localdate.Add(date, -sr.ScheduleOffset)
			if original < *sr.Task.ScheduledDate || (sr.EndDate != nil && original > *sr.EndDate) || (sr.StoppedAfter != nil && date > *sr.StoppedAfter) || localdate.Days(*sr.Task.ScheduledDate, original)%sr.IntervalDays != 0 {
				continue
			}
			var exists bool
			e = repository.OccurrenceIsMaterialized(ctx, tx, user, sr.ID, original, date, explicit, &exists)
			if e != nil {
				return e
			}
			if exists {
				continue
			}
			in := sr.Task
			in.ScheduledDate = &date
			effective := now
			if start := localdate.Boundary(date, loc).UTC(); effective.After(start) {
				effective = start
			}
			if effective.Before(sr.CreatedAt) {
				effective = sr.CreatedAt
			}
			invalid := false
			if in.StartTime != nil {
				for _, clock := range []string{*in.StartTime + ":00", *in.EndTime + ":00"} {
					if _, err := localdate.Instant(date, clock, loc); err != nil {
						invalid = true
					}
				}
			}
			if sr.Offset != nil {
				instant, err := localdate.Instant(localdate.Add(date, *sr.Offset), *sr.DeadlineTime, loc)
				if err != nil {
					invalid = true
				} else {
					v := instant.UTC()
					in.Deadline = &v
				}
			}
			if invalid {
				_, e = repository.InsertInvalidTimeException(ctx, tx, user, sr.ID, original, now)
				if e != nil {
					return e
				}
				continue
			}
			t, err := repository.InsertOccurrence(ctx, tx, user, uuid.NewString(), in.Title, in.Description, in.GroupID, in.Priority, date, in.StartTime, in.EndTime, in.Deadline, in.EstimatedPomodoros, effective, sr.ID, original, in.FocusMinutes)
			if err != nil {
				return err
			}
			if e = Event(ctx, tx, user, zone, "created", effective, nil, t); e != nil {
				return e
			}
		}
	}
	return nil
}
