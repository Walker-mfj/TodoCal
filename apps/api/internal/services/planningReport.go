package services

import (
	"context"
	"errors"
	"math"
	"time"

	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"

	"github.com/jackc/pgx/v5"
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
		// A backward zone change can reopen a date with an accepted plan.
		// Unattributed tasks supplement that plan without replacing its entries.
		loc, err := time.LoadLocation(zone)
		if err != nil {
			return out, err
		}
		if date >= now.In(loc).Format("2006-01-02") {
			live, err := liveEntries(ctx, tx, user, date)
			if err != nil {
				return out, err
			}
			saved := map[string]bool{}
			for _, entry := range out.Entries {
				saved[entry.Task.ID] = true
			}
			for _, entry := range live {
				if saved[entry.Task.ID] {
					continue
				}
				entry.Timezone, entry.Live = zone, true
				out.Entries = append(out.Entries, entry)
				out.Planned++
				if entry.Task.Status == "complete" {
					out.Completed++
				}
			}
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

// DayAt reconstructs a partial historical comparison without changing its snapshot.
func DayAt(ctx context.Context, tx pgx.Tx, user, zone, date string, cutoff time.Time) (Day, error) {
	out := Day{Date: date, Timezone: zone, Finalized: true, Entries: []Entry{}}
	states, e := repository.ListComparisonTaskStates(ctx, tx, user, date, zone, cutoff.Add(time.Microsecond))
	if e != nil {
		return out, e
	}
	out.Planned = len(states)
	for _, state := range states {
		entry, err := enrich(ctx, tx, user, projectTask(state.Task, state.Timezone))
		if err != nil {
			return out, err
		}
		entry.Timezone = state.Timezone
		out.Entries = append(out.Entries, entry)
		if entry.Task.Status == "complete" {
			out.Completed++
		}
	}
	out.Percentage = percentage(out.Planned, out.Completed)
	return out, nil
}
