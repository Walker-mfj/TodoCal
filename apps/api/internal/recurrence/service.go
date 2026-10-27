package recurrence

import (
	"context"
	"encoding/json"
	"errors"
	"focuscalendar/internal/localdate"
	"focuscalendar/internal/tasks"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"time"
)

type Input struct {
	Task         tasks.Input `json:"task"`
	Cadence      string      `json:"cadence"`
	IntervalDays int         `json:"intervalDays"`
	EndDate      *string     `json:"endDate"`
}
type Series struct {
	Input
	ID             string    `json:"id"`
	Revision       int64     `json:"revision"`
	StoppedAfter   *string   `json:"stoppedAfter"`
	CreatedAt      time.Time `json:"createdAt"`
	scheduleOffset int
	offset         *int
	deadlineTime   *string
}

func Create(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, in Input) (Series, error) {
	var out Series
	if in.Task.ScheduledDate == nil {
		return out, tasks.Invalid("Repeating tasks require a start date")
	}
	if err := tasks.Validate(&in.Task, zone, now, nil); err != nil {
		return out, err
	}
	if err := tasks.EditableDate(ctx, tx, user, in.Task.ScheduledDate); err != nil {
		return out, err
	}
	if err := tasks.CheckGroup(ctx, tx, user, in.Task.GroupID); err != nil {
		return out, err
	}
	switch in.Cadence {
	case "daily":
		if in.IntervalDays != 0 && in.IntervalDays != 1 {
			return out, tasks.Invalid("Daily interval must be 1")
		}
		in.IntervalDays = 1
	case "weekly":
		if in.IntervalDays != 0 && in.IntervalDays != 7 {
			return out, tasks.Invalid("Weekly interval must be 7")
		}
		in.IntervalDays = 7
	case "interval":
		if in.IntervalDays < 2 || in.IntervalDays > 365 {
			return out, tasks.Invalid("Interval must be 2–365 days")
		}
	default:
		return out, tasks.Invalid("Choose daily, interval, or weekly recurrence")
	}
	if in.EndDate != nil {
		if _, e := localdate.Parse(*in.EndDate); e != nil || *in.EndDate < *in.Task.ScheduledDate {
			return out, tasks.Invalid("End date must be on or after the start date")
		}
	}
	out = Series{Input: in, ID: uuid.NewString(), Revision: 1, CreatedAt: now}
	if in.Task.Deadline != nil {
		loc, e := time.LoadLocation(zone)
		if e != nil {
			return out, e
		}
		d := in.Task.Deadline.In(loc)
		offset := localdate.Days(*in.Task.ScheduledDate, d.Format("2006-01-02"))
		clock := d.Format("15:04:05")
		out.offset = &offset
		out.deadlineTime = &clock
	}
	template, e := json.Marshal(in.Task)
	if e != nil {
		return out, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO recurrence_series(user_id,id,template,group_id,start_date,cadence,interval_days,end_date,deadline_offset,deadline_time,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, user, out.ID, template, in.Task.GroupID, in.Task.ScheduledDate, in.Cadence, in.IntervalDays, in.EndDate, out.offset, out.deadlineTime, now)
	if e != nil {
		return out, e
	}
	// Create the first occurrence, then materialize only requested ranges and elapsed days.
	return out, Materialize(ctx, tx, user, zone, *in.Task.ScheduledDate, localdate.Add(*in.Task.ScheduledDate, 1), now)
}
func Materialize(ctx context.Context, tx pgx.Tx, user, zone, from, to string, now time.Time) error {
	if _, e := localdate.Parse(from); e != nil {
		return tasks.Invalid("Invalid range start")
	}
	if _, e := localdate.Parse(to); e != nil {
		return tasks.Invalid("Invalid range end")
	}
	if n := localdate.Days(from, to); n < 1 || n > 93 {
		return tasks.Invalid("Calendar range must be 1–93 days")
	}
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return e
	}
	rows, e := tx.Query(ctx, `SELECT id::text,template,group_id::text,start_date::text,cadence,interval_days,end_date::text,stopped_after::text,deadline_offset,deadline_time,created_at,schedule_offset_days FROM recurrence_series WHERE user_id=$1 AND start_date+schedule_offset_days<$3::date AND (end_date IS NULL OR end_date+schedule_offset_days>=$2::date) AND (stopped_after IS NULL OR stopped_after>=$2::date)`, user, from, to)
	if e != nil {
		return e
	}
	all := []Series{}
	for rows.Next() {
		var sr Series
		var raw []byte
		var start string
		var group *string
		if e = rows.Scan(&sr.ID, &raw, &group, &start, &sr.Cadence, &sr.IntervalDays, &sr.EndDate, &sr.StoppedAfter, &sr.offset, &sr.deadlineTime, &sr.CreatedAt, &sr.scheduleOffset); e != nil {
			rows.Close()
			return e
		}
		if e = json.Unmarshal(raw, &sr.Task); e != nil {
			rows.Close()
			return e
		}
		sr.Task.GroupID = group
		sr.Task.ScheduledDate = &start
		all = append(all, sr)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, sr := range all {
		for date := from; date < to; date = localdate.Add(date, 1) {
			original := localdate.Add(date, -sr.scheduleOffset)
			if original < *sr.Task.ScheduledDate || (sr.EndDate != nil && original > *sr.EndDate) || (sr.StoppedAfter != nil && date > *sr.StoppedAfter) || localdate.Days(*sr.Task.ScheduledDate, original)%sr.IntervalDays != 0 {
				continue
			}
			var exists bool
			e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tasks WHERE user_id=$1 AND series_id=$2 AND original_occurrence_date=$3) OR EXISTS(SELECT 1 FROM recurrence_exceptions WHERE user_id=$1 AND series_id=$2 AND original_occurrence_date=$3) OR EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date=$4)`, user, sr.ID, original, date).Scan(&exists)
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
			if sr.offset != nil {
				instant, err := localdate.Instant(localdate.Add(date, *sr.offset), *sr.deadlineTime, loc)
				if err != nil {
					invalid = true
				} else {
					v := instant.UTC()
					in.Deadline = &v
				}
			}
			if invalid {
				_, e = tx.Exec(ctx, `INSERT INTO recurrence_exceptions(user_id,series_id,original_occurrence_date,reason,created_at) VALUES($1,$2,$3,'invalid_local_time',$4) ON CONFLICT DO NOTHING`, user, sr.ID, original, now)
				if e != nil {
					return e
				}
				continue
			}
			t, err := tasks.Scan(tx.QueryRow(ctx, `INSERT INTO tasks(user_id,id,title,description,group_id,priority,scheduled_date,start_time,end_time,deadline,estimated_pomodoros,created_at,updated_at,series_id,original_occurrence_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14) RETURNING `+tasks.Columns, user, uuid.NewString(), in.Title, in.Description, in.GroupID, in.Priority, date, in.StartTime, in.EndTime, in.Deadline, in.EstimatedPomodoros, effective, sr.ID, original))
			if err != nil {
				return err
			}
			if e = tasks.Event(ctx, tx, user, zone, "created", effective, nil, t); e != nil {
				return e
			}
		}
	}
	return nil
}
func Stop(ctx context.Context, tx pgx.Tx, user, zone, id string, now time.Time, revision int64) (any, error) {
	parsed, e := uuid.Parse(id)
	if e != nil {
		return nil, tasks.Missing()
	}
	id = parsed.String()
	var rev int64
	var stopped *string
	e = tx.QueryRow(ctx, `SELECT revision,stopped_after::text FROM recurrence_series WHERE user_id=$1 AND id=$2`, user, id).Scan(&rev, &stopped)
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, tasks.Missing()
	}
	if e != nil {
		return nil, e
	}
	if rev != revision {
		return nil, tasks.Conflict()
	}
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return nil, e
	}
	today := now.In(loc).Format("2006-01-02")
	if stopped != nil {
		return map[string]any{"id": id, "revision": rev, "stoppedAfter": stopped}, nil
	}
	_, e = tx.Exec(ctx, `UPDATE recurrence_series SET stopped_after=$3,revision=revision+1 WHERE user_id=$1 AND id=$2`, user, id, today)
	if e != nil {
		return nil, e
	}
	rows, e := tx.Query(ctx, `SELECT `+tasks.Columns+` FROM tasks WHERE user_id=$1 AND series_id=$2 AND (scheduled_date>$3::date OR (scheduled_date IS NULL AND original_occurrence_date>$3::date)) AND status='incomplete' AND deleted_at IS NULL`, user, id, today)
	if e != nil {
		return nil, e
	}
	affected := []tasks.Task{}
	for rows.Next() {
		t, err := tasks.Scan(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		affected = append(affected, t)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	for _, t := range affected {
		if e = tasks.Delete(ctx, tx, user, zone, now, t); e != nil {
			return nil, e
		}
	}
	return map[string]any{"id": id, "revision": rev + 1, "stoppedAfter": today}, nil
}

// Get returns the current series metadata without materializing occurrences.
func Get(ctx context.Context, tx pgx.Tx, user, id string) (Series, error) {
	var out Series
	parsed, err := uuid.Parse(id)
	if err != nil {
		return out, tasks.Missing()
	}
	var raw []byte
	var group *string
	err = tx.QueryRow(ctx, `SELECT id::text,template,group_id::text,cadence,interval_days,end_date::text,stopped_after::text,revision,created_at,schedule_offset_days,deadline_offset,deadline_time FROM recurrence_series WHERE user_id=$1 AND id=$2`, user, parsed.String()).Scan(&out.ID, &raw, &group, &out.Cadence, &out.IntervalDays, &out.EndDate, &out.StoppedAfter, &out.Revision, &out.CreatedAt, &out.scheduleOffset, &out.offset, &out.deadlineTime)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, tasks.Missing()
	}
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(raw, &out.Task)
	out.Task.GroupID = group
	if out.EndDate != nil {
		end := localdate.Add(*out.EndDate, out.scheduleOffset)
		out.EndDate = &end
	}
	return out, err
}

// UpdateFromTask changes live occurrences and the lazy template in the same
// account transaction. Original occurrence keys stay stable when dates move.
func UpdateFromTask(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, selected tasks.Task, in tasks.Input, revision int64, fields map[string]json.RawMessage) (tasks.Task, error) {
	if selected.SeriesID == nil {
		return tasks.Task{}, tasks.Invalid("This task does not repeat")
	}
	sr, err := Get(ctx, tx, user, *selected.SeriesID)
	if err != nil {
		return tasks.Task{}, err
	}
	if sr.Revision != revision {
		return tasks.Task{}, tasks.Conflict()
	}
	if in.ScheduledDate == nil || selected.ScheduledDate == nil {
		return tasks.Task{}, tasks.Invalid("Repeating tasks require a scheduled date")
	}
	if err = tasks.Validate(&in, zone, now, &selected); err != nil {
		return tasks.Task{}, err
	}
	if err = tasks.CheckGroup(ctx, tx, user, in.GroupID); err != nil {
		return tasks.Task{}, err
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return tasks.Task{}, err
	}
	today := now.In(loc).Format("2006-01-02")
	if *selected.ScheduledDate < today {
		return tasks.Task{}, tasks.Invalid("Choose a current or future occurrence to edit the series")
	}
	delta := localdate.Days(*selected.ScheduledDate, *in.ScheduledDate)
	offset := sr.scheduleOffset + delta
	_, editsDeadline := fields["deadline"]
	deadlineOffset, deadlineClock := sr.offset, sr.deadlineTime
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
	rows, err := tx.Query(ctx, `SELECT `+tasks.Columns+` FROM tasks WHERE user_id=$1 AND series_id=$2 AND deleted_at IS NULL AND scheduled_date >= $3::date AND NOT EXISTS (SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date=tasks.scheduled_date)`, user, sr.ID, today)
	if err != nil {
		return tasks.Task{}, err
	}
	affected := []tasks.Task{}
	for rows.Next() {
		t, e := tasks.Scan(rows)
		if e != nil {
			rows.Close()
			return tasks.Task{}, e
		}
		affected = append(affected, t)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return tasks.Task{}, err
	}
	result := selected
	for _, old := range affected {
		next := applyFields(old.Input, in, fields)
		date := localdate.Add(*old.ScheduledDate, delta)
		next.ScheduledDate = &date
		if editsDeadline && deadlineOffset != nil {
			d, e := localdate.Instant(localdate.Add(date, *deadlineOffset), *deadlineClock, loc)
			if e != nil {
				return tasks.Task{}, tasks.Invalid("This deadline does not exist in your time zone")
			}
			next.Deadline = &d
		}
		// Existing tasks may have activity attached; never silently drop one
		// when a series edit selects a nonexistent wall time.
		if validation := tasks.Validate(&next, zone, now, &old); validation != nil {
			return tasks.Task{}, tasks.Invalid("Cannot update occurrence on " + date + ": " + validation.Error())
		}
		updated, e := tasks.Update(ctx, tx, user, zone, now, old, next)
		if e != nil {
			return tasks.Task{}, e
		}
		if old.ID == selected.ID {
			result = updated
		}
	}
	// Keep the cadence anchor fixed; the offset shifts each generated occurrence.
	var anchor string
	if err = tx.QueryRow(ctx, `SELECT start_date::text FROM recurrence_series WHERE user_id=$1 AND id=$2`, user, sr.ID).Scan(&anchor); err != nil {
		return tasks.Task{}, err
	}
	effectiveAnchor := localdate.Add(anchor, offset)
	in = applyFields(sr.Task, in, fields)
	// Validate the merged lazy template independently of occurrence overrides.
	// Its cadence anchor can be historical, so use the selected effective date.
	validationDate := localdate.Add(*selected.ScheduledDate, delta)
	in.ScheduledDate = &validationDate
	if err = tasks.Validate(&in, zone, now, nil); err != nil {
		return tasks.Task{}, err
	}
	in.ScheduledDate = &effectiveAnchor
	raw, err := json.Marshal(in)
	if err != nil {
		return tasks.Task{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE recurrence_series SET template=$3,group_id=$4,deadline_offset=$5,deadline_time=$6,schedule_offset_days=$7,revision=revision+1 WHERE user_id=$1 AND id=$2`, user, sr.ID, raw, in.GroupID, deadlineOffset, deadlineClock, offset)
	if err != nil {
		return tasks.Task{}, err
	}
	// Invalid-time predictions may now be valid. Explicitly deleted/moved slots stay suppressed.
	_, err = tx.Exec(ctx, `DELETE FROM recurrence_exceptions WHERE user_id=$1 AND series_id=$2 AND reason='invalid_local_time' AND original_occurrence_date+$3::integer >= $4::date`, user, sr.ID, offset, today)
	return result, err
}

// Apply only explicitly supplied content fields; occurrences may have their own
// titles, notes, groups, or deadlines. Schedule dates are shifted separately.
func applyFields(base, edited tasks.Input, fields map[string]json.RawMessage) tasks.Input {
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
		case "estimatedPomodoros":
			base.EstimatedPomodoros = edited.EstimatedPomodoros
		}
	}
	return base
}
