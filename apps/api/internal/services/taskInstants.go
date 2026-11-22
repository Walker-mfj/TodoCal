package services

import (
	"focuscalendar/internal/localdate"
	"time"
)

// taskInstants resolves local API fields once, retaining exact stored instants
// on content-only edits (including the later side of a DST overlap).
func taskInstants(in TaskInput, zone string, previous *Task) (*time.Time, *time.Time, error) {
	if (in.StartTime == nil) != (in.EndTime == nil) {
		return nil, nil, Invalid("Provide both start and end times")
	}
	if in.StartTime == nil {
		return nil, nil, nil
	}
	if in.ScheduledDate == nil {
		return nil, nil, Invalid("Times require a scheduled date")
	}
	endDate := in.ScheduledEndDate
	if endDate == nil {
		endDate = in.ScheduledDate
	}
	if _, err := localdate.Parse(*endDate); err != nil {
		return nil, nil, Invalid("Use a valid scheduled end date")
	}
	if previous != nil && previous.ScheduledStartAt != nil && previous.ScheduledEndAt != nil &&
		sameDate(in.ScheduledDate, previous.ScheduledDate) && sameDate(endDate, previous.ScheduledEndDate) &&
		sameDate(in.StartTime, previous.StartTime) && sameDate(in.EndTime, previous.EndTime) {
		return previous.ScheduledStartAt, previous.ScheduledEndAt, nil
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return nil, nil, err
	}
	for _, clock := range []string{*in.StartTime, *in.EndTime} {
		v, e := time.Parse("15:04", clock)
		if e != nil || v.Format("15:04") != clock {
			return nil, nil, Invalid("Use HH:mm times")
		}
	}
	start, e := localdate.Instant(*in.ScheduledDate, *in.StartTime+":00", loc)
	if previous != nil && previous.ScheduledStartAt != nil && sameDate(in.ScheduledDate, previous.ScheduledDate) && sameDate(in.StartTime, previous.StartTime) {
		start, e = *previous.ScheduledStartAt, nil
	}
	if e != nil {
		return nil, nil, Invalid("This local start time does not exist in your time zone")
	}
	end, e := localdate.Instant(*endDate, *in.EndTime+":00", loc)
	if previous != nil && previous.ScheduledEndAt != nil && sameDate(endDate, previous.ScheduledEndDate) && sameDate(in.EndTime, previous.EndTime) {
		end, e = *previous.ScheduledEndAt, nil
	}
	if e != nil {
		return nil, nil, Invalid("This local end time does not exist in your time zone")
	}
	if !end.After(start) {
		return nil, nil, Invalid("End must be after start")
	}
	start, end = start.UTC(), end.UTC()
	return &start, &end, nil
}

// projectTask changes only the local view of a persisted interval.
func projectTask(t Task, zone string) Task {
	loc, err := time.LoadLocation(zone)
	if err != nil || t.ScheduledStartAt == nil || t.ScheduledEndAt == nil {
		return t
	}
	start, end := t.ScheduledStartAt.In(loc), t.ScheduledEndAt.In(loc)
	date, endDate, a, b := start.Format("2006-01-02"), end.Format("2006-01-02"), start.Format("15:04"), end.Format("15:04")
	t.ScheduledDate, t.ScheduledEndDate, t.StartTime, t.EndTime = &date, &endDate, &a, &b
	return t
}

func shiftScheduleDate(in *TaskInput, date string) {
	if in.ScheduledEndDate != nil && in.ScheduledDate != nil {
		end := localdate.Add(date, localdate.Days(*in.ScheduledDate, *in.ScheduledEndDate))
		in.ScheduledEndDate = &end
	}
	in.ScheduledDate = &date
}

func inputInZone(in TaskInput, old Task, from, to string) (TaskInput, error) {
	if err := Validate(&in, from, time.Time{}, &old); err != nil {
		return in, err
	}
	a, b, err := taskInstants(in, from, &old)
	if err != nil {
		return in, err
	}
	return projectTask(Task{TaskInput: in, ScheduledStartAt: a, ScheduledEndAt: b}, to).TaskInput, nil
}

func sameScheduledStart(a, b Task) bool {
	if a.ScheduledStartAt != nil && b.ScheduledStartAt != nil {
		return a.ScheduledStartAt.Equal(*b.ScheduledStartAt)
	}
	return a.ScheduledStartAt == nil && b.ScheduledStartAt == nil && sameDate(a.ScheduledDate, b.ScheduledDate)
}

// Repeated intervals are bounded so a calendar/horizon read cannot expand an
// arbitrary number of overlapping occurrences in one account transaction.
func validateSeriesSpan(in TaskInput) error {
	if in.ScheduledDate != nil && in.ScheduledEndDate != nil && localdate.Days(*in.ScheduledDate, *in.ScheduledEndDate) > 366 {
		return Invalid("A repeating task may span at most 366 days")
	}
	return nil
}
