package services

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"focuscalendar/internal/localdate"
	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type SeriesInput = models.SeriesInput

type Series = models.Series

func CreateSeries(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, in SeriesInput) (Series, error) {
	var out Series
	if in.Task.ScheduledDate == nil {
		return out, Invalid("Repeating tasks require a start date")
	}
	if err := Validate(&in.Task, zone, now, nil); err != nil {
		return out, err
	}
	if err := EditableDate(ctx, tx, user, in.Task.ScheduledDate); err != nil {
		return out, err
	}
	if err := CheckGroup(ctx, tx, user, in.Task.GroupID); err != nil {
		return out, err
	}
	switch in.Cadence {
	case "daily":
		if in.IntervalDays != 0 && in.IntervalDays != 1 {
			return out, Invalid("Daily interval must be 1")
		}
		in.IntervalDays = 1
	case "weekly":
		if in.IntervalDays != 0 && in.IntervalDays != 7 {
			return out, Invalid("Weekly interval must be 7")
		}
		in.IntervalDays = 7
	case "interval":
		if in.IntervalDays < 2 || in.IntervalDays > 365 {
			return out, Invalid("Interval must be 2–365 days")
		}
	default:
		return out, Invalid("Choose daily, interval, or weekly recurrence")
	}
	if in.EndDate != nil {
		if _, e := localdate.Parse(*in.EndDate); e != nil || *in.EndDate < *in.Task.ScheduledDate {
			return out, Invalid("End date must be on or after the start date")
		}
	}
	out = Series{SeriesInput: in, ID: uuid.NewString(), Revision: 1, CreatedAt: now}
	if in.Task.Deadline != nil {
		loc, e := time.LoadLocation(zone)
		if e != nil {
			return out, e
		}
		d := in.Task.Deadline.In(loc)
		Offset := localdate.Days(*in.Task.ScheduledDate, d.Format("2006-01-02"))
		clock := d.Format("15:04:05")
		out.Offset = &Offset
		out.DeadlineTime = &clock
	}
	template, e := json.Marshal(in.Task)
	if e != nil {
		return out, e
	}
	_, e = repository.InsertSeries(ctx, tx, user, out.ID, template, in.Task.GroupID, in.Task.ScheduledDate, in.Cadence, in.IntervalDays, in.EndDate, out.Offset, out.DeadlineTime, now)
	if e != nil {
		return out, e
	}
	// An explicit historical series creation may add occurrences to finalized
	// days. Only this newly created series bypasses their materialization guard.
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return out, err
	}
	end := localdate.Add(*in.Task.ScheduledDate, 1)
	if todayEnd := localdate.Add(now.In(loc).Format("2006-01-02"), 1); todayEnd > end {
		end = todayEnd
	}
	if in.EndDate != nil && localdate.Add(*in.EndDate, 1) < end {
		end = localdate.Add(*in.EndDate, 1)
	}
	for from := *in.Task.ScheduledDate; from < end; {
		to := localdate.Add(from, 93)
		if to > end {
			to = end
		}
		if err = Materialize(ctx, tx, user, zone, from, to, now, out.ID); err != nil {
			return out, err
		}
		from = to
	}
	return out, nil
}

// Get returns the current series metadata without materializing occurrences.
func GetSeries(ctx context.Context, tx pgx.Tx, user, id string) (Series, error) {
	var out Series
	parsed, err := uuid.Parse(id)
	if err != nil {
		return out, Missing()
	}
	var raw []byte
	var group *string
	err = repository.ReadSeries(ctx, tx, user, parsed.String(), &out.ID, &raw, &group, &out.Cadence, &out.IntervalDays, &out.EndDate, &out.StoppedAfter, &out.Revision, &out.CreatedAt, &out.ScheduleOffset, &out.Offset, &out.DeadlineTime)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, Missing()
	}
	if err != nil {
		return out, err
	}
	err = tx.QueryRow(ctx, `SELECT original_cutoff::text FROM recurrence_series WHERE user_id=$1 AND id=$2`, user, out.ID).Scan(&out.OriginalCutoff)
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(raw, &out.Task)
	out.Task.GroupID = group
	if out.EndDate != nil {
		end := localdate.Add(*out.EndDate, out.ScheduleOffset)
		out.EndDate = &end
	}
	return out, err
}
