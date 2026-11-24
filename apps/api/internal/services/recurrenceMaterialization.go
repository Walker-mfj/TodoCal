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
	all, e := repository.ListMaterializableSeries(ctx, tx, user, localdate.Add(from, -2), localdate.Add(to, 2), selected)
	if e != nil {
		return e
	}
	for _, sr := range all {
		seriesLoc, err := time.LoadLocation(sr.Timezone)
		if err != nil {
			return err
		}
		seriesFrom, seriesTo := from, to
		if sr.Timezone != zone {
			seriesFrom, seriesTo = localdate.Add(from, -2), localdate.Add(to, 2)
		}
		// Reminder horizons only need future starts, not overlapping past starts.
		if selected == "" {
			seriesFrom = localdate.Add(seriesFrom, -sr.EndOffset)
		}
		if first := localdate.Add(*sr.Task.ScheduledDate, sr.ScheduleOffset); seriesFrom < first {
			seriesFrom = first
		}
		anchor := localdate.Add(*sr.Task.ScheduledDate, sr.ScheduleOffset)
		if remainder := localdate.Days(anchor, seriesFrom) % sr.IntervalDays; remainder != 0 {
			seriesFrom = localdate.Add(seriesFrom, sr.IntervalDays-remainder)
		}
		for date := seriesFrom; date < seriesTo; date = localdate.Add(date, sr.IntervalDays) {
			original := localdate.Add(date, -sr.ScheduleOffset)
			if original < *sr.Task.ScheduledDate || (sr.EndDate != nil && original > *sr.EndDate) || (sr.StoppedAfter != nil && date > *sr.StoppedAfter) || localdate.Days(*sr.Task.ScheduledDate, original)%sr.IntervalDays != 0 {
				continue
			}
			in := sr.Task
			in.ScheduledDate = &date
			if in.StartTime != nil {
				endDate := localdate.Add(date, sr.EndOffset)
				in.ScheduledEndDate = &endDate
			}
			startAt, endAt, resolveErr := taskInstants(in, sr.Timezone, nil)
			invalid := resolveErr != nil
			if sr.Offset != nil {
				instant, err := localdate.Instant(localdate.Add(date, *sr.Offset), *sr.DeadlineTime, seriesLoc)
				if err != nil {
					invalid = true
				} else {
					v := instant.UTC()
					in.Deadline = &v
				}
			}
			reportDate := date
			if startAt != nil {
				reportDate = startAt.In(loc).Format("2006-01-02")
			}
			// Cutoffs and durable exceptions suppress slots before recording any
			// invalid-time prediction, including slots transferred to a split series.
			var exists bool
			e = repository.OccurrenceIsMaterialized(ctx, tx, user, sr.ID, original, reportDate, explicit, startAt, zone, &exists)
			if e != nil {
				return e
			}
			if exists {
				continue
			}
			if invalid {
				_, e = repository.InsertInvalidTimeException(ctx, tx, user, sr.ID, original, now)
				if e != nil {
					return e
				}
				continue
			}
			effective := now
			if start := localdate.Boundary(reportDate, loc).UTC(); effective.After(start) {
				effective = start
			}
			if effective.Before(sr.CreatedAt) {
				effective = sr.CreatedAt
			}
			t, err := repository.InsertOccurrence(ctx, tx, user, uuid.NewString(), in.Title, in.Description, in.GroupID, in.Priority, date, in.StartTime, in.EndTime, in.Deadline, in.EstimatedPomodoros, effective, sr.ID, original, in.FocusMinutes, in.ScheduledEndDate, startAt, endAt)
			if err != nil {
				return err
			}
			if e = recordTaskEvent(ctx, tx, user, zone, "created", effective, nil, t, explicit == sr.ID); e != nil {
				return e
			}
		}
	}
	return nil
}
