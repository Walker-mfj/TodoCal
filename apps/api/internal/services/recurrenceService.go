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
func Materialize(ctx context.Context, tx pgx.Tx, user, zone, from, to string, now time.Time, explicitSeries ...string) error {
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
	all, e := repository.ListMaterializableSeries(ctx, tx, user, from, to)
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

// UpdateFromTask changes live occurrences and the lazy template in the same
// account transaction. Original occurrence keys stay stable when dates move.
func UpdateFromTask(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, selected Task, in TaskInput, revision int64, fields map[string]json.RawMessage) (Task, error) {
	if selected.SeriesID == nil {
		return Task{}, Invalid("This task does not repeat")
	}
	sr, err := GetSeries(ctx, tx, user, *selected.SeriesID)
	if err != nil {
		return Task{}, err
	}
	if sr.Revision != revision {
		return Task{}, Conflict()
	}
	if in.ScheduledDate == nil || selected.ScheduledDate == nil {
		return Task{}, Invalid("Repeating tasks require a scheduled date")
	}
	if err = Validate(&in, zone, now, &selected); err != nil {
		return Task{}, err
	}
	if err = CheckGroup(ctx, tx, user, in.GroupID); err != nil {
		return Task{}, err
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return Task{}, err
	}
	today := now.In(loc).Format("2006-01-02")
	if *selected.ScheduledDate < today {
		return Task{}, Invalid("Choose a current or future occurrence to edit the series")
	}
	delta := localdate.Days(*selected.ScheduledDate, *in.ScheduledDate)
	Offset := sr.ScheduleOffset + delta
	_, editsDeadline := fields["deadline"]
	deadlineOffset, deadlineClock := sr.Offset, sr.DeadlineTime
	if !editsDeadline && deadlineOffset != nil {
		shifted := *deadlineOffset - delta
		deadlineOffset = &shifted
	}
	if editsDeadline {
		deadlineOffset, deadlineClock = nil, nil
	}
	if editsDeadline && in.Deadline != nil {
		d := in.Deadline.In(loc)
		n := localdate.Days(*in.ScheduledDate, d.Format("2006-01-02"))
		clock := d.Format("15:04:05")
		deadlineOffset, deadlineClock = &n, &clock
	}
	affected, err := repository.ListEditableOccurrences(ctx, tx, user, sr.ID, today)
	if err != nil {
		return Task{}, err
	}
	result := selected
	for _, old := range affected {
		next := applyFields(old.TaskInput, in, fields)
		date := localdate.Add(*old.ScheduledDate, delta)
		next.ScheduledDate = &date
		if editsDeadline && deadlineOffset != nil {
			d, e := localdate.Instant(localdate.Add(date, *deadlineOffset), *deadlineClock, loc)
			if e != nil {
				return Task{}, Invalid("This deadline does not exist in your time zone")
			}
			next.Deadline = &d
		}
		// Existing tasks may have activity attached; never silently drop one
		// when a series edit selects a nonexistent wall time.
		if validation := Validate(&next, zone, now, &old); validation != nil {
			return Task{}, Invalid("Cannot update occurrence on " + date + ": " + validation.Error())
		}
		updated, e := UpdateTask(ctx, tx, user, zone, now, old, next)
		if e != nil {
			return Task{}, e
		}
		if old.ID == selected.ID {
			result = updated
		}
	}
	// Keep the cadence anchor fixed; the offset shifts each generated occurrence.
	var anchor string
	if err = repository.ReadSeriesStartDate(ctx, tx, user, sr.ID, &anchor); err != nil {
		return Task{}, err
	}
	effectiveAnchor := localdate.Add(anchor, Offset)
	in = applyFields(sr.Task, in, fields)
	// Validate the merged lazy template independently of occurrence overrides.
	// Its cadence anchor can be historical, so use the selected effective date.
	validationDate := localdate.Add(*selected.ScheduledDate, delta)
	in.ScheduledDate = &validationDate
	if err = Validate(&in, zone, now, nil); err != nil {
		return Task{}, err
	}
	in.ScheduledDate = &effectiveAnchor
	raw, err := json.Marshal(in)
	if err != nil {
		return Task{}, err
	}
	_, err = repository.UpdateSeriesTemplate(ctx, tx, user, sr.ID, raw, in.GroupID, deadlineOffset, deadlineClock, Offset)
	if err != nil {
		return Task{}, err
	}
	// Invalid-time predictions may now be valid. Explicitly deleted/moved slots stay suppressed.
	_, err = repository.ClearShiftedInvalidTimeExceptions(ctx, tx, user, sr.ID, Offset, today)
	return result, err
}

// Apply only explicitly supplied content fields; occurrences may have their own
// titles, notes, groups, or deadlines. Schedule dates are shifted separately.
func applyFields(base, edited TaskInput, fields map[string]json.RawMessage) TaskInput {
	for name := range fields {
		switch name {
		case "title":
			base.Title = edited.Title
		case "description":
			base.Description = edited.Description
		case "groupId":
			base.GroupID = edited.GroupID
		case "priority":
			base.Priority = edited.Priority
		case "startTime":
			base.StartTime = edited.StartTime
		case "endTime":
			base.EndTime = edited.EndTime
		case "deadline":
			base.Deadline = edited.Deadline
		case "focusMinutes":
			base.FocusMinutes = edited.FocusMinutes
		case "estimatedPomodoros":
			base.EstimatedPomodoros = edited.EstimatedPomodoros
		}
	}
	return base
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
