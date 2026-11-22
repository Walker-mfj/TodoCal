package services

import (
	"context"
	"encoding/json"
	"time"

	"focuscalendar/internal/localdate"
	"focuscalendar/internal/repository"

	"github.com/jackc/pgx/v5"
)

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
	in, err = inputInZone(in, selected, zone, sr.Timezone)
	if err != nil {
		return Task{}, err
	}
	selected = projectTask(selected, sr.Timezone)
	fields = seriesScheduleFields(fields, selected.TaskInput, in)
	zone = sr.Timezone
	if in.ScheduledDate == nil || selected.ScheduledDate == nil {
		return Task{}, Invalid("Repeating tasks require a scheduled date")
	}
	if err = Validate(&in, zone, now, &selected); err != nil {
		return Task{}, err
	}
	if err = validateSeriesSpan(in); err != nil {
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
	affected, err := repository.ListEditableOccurrences(ctx, tx, user, sr.ID, today, zone)
	if err != nil {
		return Task{}, err
	}
	result := selected
	for _, old := range affected {
		old = projectTask(old, zone)
		next := applyFields(old.TaskInput, in, fields)
		date := localdate.Add(*old.ScheduledDate, delta)
		shiftScheduleDate(&next, date)
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
	shiftScheduleDate(&in, validationDate)
	if err = Validate(&in, zone, now, nil); err != nil {
		return Task{}, err
	}
	shiftScheduleDate(&in, effectiveAnchor)
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
		case "scheduledEndDate":
			if edited.ScheduledEndDate == nil {
				base.ScheduledEndDate = nil
			} else if base.ScheduledDate != nil && edited.ScheduledDate != nil {
				end := localdate.Add(*base.ScheduledDate, localdate.Days(*edited.ScheduledDate, *edited.ScheduledEndDate))
				base.ScheduledEndDate = &end
			}
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

// Account-local changes can also change the end-day offset or clocks in the
// series zone. Carry those derived changes into both instances and templates.
func seriesScheduleFields(fields map[string]json.RawMessage, before, after TaskInput) map[string]json.RawMessage {
	changed := false
	for _, key := range []string{"scheduledDate", "scheduledEndDate", "startTime", "endTime"} {
		if _, ok := fields[key]; ok {
			changed = true
		}
	}
	if !changed {
		return fields
	}
	out := make(map[string]json.RawMessage, len(fields)+3)
	for k, v := range fields {
		out[k] = v
	}
	if !sameDate(before.StartTime, after.StartTime) {
		out["startTime"] = nil
	}
	if !sameDate(before.EndTime, after.EndTime) {
		out["endTime"] = nil
	}
	span := func(in TaskInput) int {
		if in.ScheduledDate == nil || in.ScheduledEndDate == nil {
			return 0
		}
		return localdate.Days(*in.ScheduledDate, *in.ScheduledEndDate)
	}
	if span(before) != span(after) {
		out["scheduledEndDate"] = nil
	}
	return out
}
