// Package services implements account business operations within shared transactions.
package services

import (
	"context"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Fault = models.Fault

func Invalid(message string) error { return &Fault{Code: "validation", Message: message} }
func Missing() error               { return &Fault{Code: "not_found", Message: "Resource not found"} }
func Conflict() error {
	return &Fault{Code: "revision_conflict", Message: "This item changed. Refresh and try again."}
}

type TaskInput = models.TaskInput
type Task = models.Task

func GetTask(ctx context.Context, tx pgx.Tx, user, id string) (Task, error) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return Task{}, Missing()
	}
	id = parsed.String()
	return repository.FindTask(ctx, tx, user, id)
}
func Validate(in *TaskInput, zone string, now time.Time, previous *Task) error {
	in.Title = strings.TrimSpace(in.Title)
	if n := utf8.RuneCountInString(in.Title); n == 0 || n > 300 {
		return Invalid("Use a title of 1–300 characters")
	}
	if utf8.RuneCountInString(in.Description) > 10000 {
		return Invalid("Description must be at most 10000 characters")
	}
	if in.Priority == "" {
		in.Priority = "medium"
	}
	if in.Priority != "low" && in.Priority != "medium" && in.Priority != "high" {
		return Invalid("Choose low, medium, or high priority")
	}
	if in.EstimatedPomodoros != nil && (*in.EstimatedPomodoros < 1 || *in.EstimatedPomodoros > 2147483647) {
		return Invalid("Estimated Pomodoros must be a positive integer")
	}
	if in.FocusMinutes != nil && (*in.FocusMinutes < 1 || *in.FocusMinutes > 180) {
		return Invalid("Focus minutes must be between 1 and 180")
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return err
	}
	if in.ScheduledDate != nil {
		d, e := time.Parse("2006-01-02", *in.ScheduledDate)
		if e != nil || d.Year() < 1 || d.Format("2006-01-02") != *in.ScheduledDate {
			return Invalid("Use a valid scheduled date")
		}

	}
	if (in.StartTime == nil) != (in.EndTime == nil) {
		return Invalid("Provide both start and end times")
	}
	if in.StartTime != nil {
		if in.ScheduledDate == nil {
			return Invalid("Times require a scheduled date")
		}
		for _, v := range []string{*in.StartTime, *in.EndTime} {
			parsed, e := time.Parse("15:04", v)
			if e != nil || parsed.Format("15:04") != v {
				return Invalid("Use HH:mm times")
			}
			stamp := *in.ScheduledDate + " " + v
			local, e := time.ParseInLocation("2006-01-02 15:04", stamp, loc)
			if e != nil || local.Format("2006-01-02 15:04") != stamp {
				return Invalid("This local time does not exist in your time zone")
			}
		}
		if *in.EndTime <= *in.StartTime {
			return Invalid("End time must be after start time on the same day")
		}
	}
	if in.Deadline != nil {
		if in.Deadline.Year() < 1 || in.Deadline.Year() > 9999 {
			return Invalid("Use a valid deadline")
		}
		v := in.Deadline.UTC()
		in.Deadline = &v
	}
	return nil
}
func CheckGroup(ctx context.Context, tx pgx.Tx, user string, id *string) error {
	if id == nil {
		return nil
	}
	parsed, err := uuid.Parse(*id)
	if err != nil {
		return Missing()
	}
	*id = parsed.String()
	var exists bool
	if err := repository.GroupExists(ctx, tx, user, *id, &exists); err != nil {
		return err
	}
	if !exists {
		return Missing()
	}
	return nil
}
func Event(ctx context.Context, tx pgx.Tx, user, zone, kind string, now time.Time, before *Task, after Task) error {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return err
	}
	var old []byte
	if before != nil {
		old, err = json.Marshal(before)
		if err != nil {
			return err
		}
	}
	next, err := json.Marshal(after)
	if err != nil {
		return err
	}
	historical := after.ScheduledDate != nil && *after.ScheduledDate < now.In(loc).Format("2006-01-02")
	if before != nil && before.ScheduledDate != nil && *before.ScheduledDate < now.In(loc).Format("2006-01-02") {
		historical = true
	}
	_, err = repository.InsertTaskEvent(ctx, tx, user, uuid.NewString(), after.ID, kind, now, now.In(loc).Format("2006-01-02"), zone, old, next, historical && kind != "group_cleared" && kind != "series_reparented")
	if err != nil {
		return err
	}
	if kind == "group_cleared" || kind == "series_reparented" {
		return nil
	}
	return refreshHistorical(ctx, tx, user, zone, now, before, after)
}
func CreateTask(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, in TaskInput) (Task, error) {
	if err := Validate(&in, zone, now, nil); err != nil {
		return Task{}, err
	}
	if err := CheckGroup(ctx, tx, user, in.GroupID); err != nil {
		return Task{}, err
	}
	if err := EditableDate(ctx, tx, user, in.ScheduledDate); err != nil {
		return Task{}, err
	}
	t, err := repository.InsertTask(ctx, tx, user, uuid.NewString(), in.Title, in.Description, in.GroupID, in.Priority, in.ScheduledDate, in.StartTime, in.EndTime, in.Deadline, in.EstimatedPomodoros, now, in.FocusMinutes)
	if err != nil {
		return t, err
	}
	return t, Event(ctx, tx, user, zone, "created", now, nil, t)
}
func UpdateTask(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, old Task, in TaskInput) (Task, error) {
	if err := Validate(&in, zone, now, &old); err != nil {
		return Task{}, err
	}
	if err := CheckGroup(ctx, tx, user, in.GroupID); err != nil {
		return Task{}, err
	}
	if !sameDate(old.ScheduledDate, in.ScheduledDate) {
		if err := EditableDate(ctx, tx, user, in.ScheduledDate); err != nil {
			return Task{}, err
		}
	}
	t, err := repository.UpdateTask(ctx, tx, user, old.ID, in.Title, in.Description, in.GroupID, in.Priority, in.ScheduledDate, in.StartTime, in.EndTime, in.Deadline, in.EstimatedPomodoros, now, in.FocusMinutes)
	if err != nil {
		return t, err
	}
	if !sameDate(old.ScheduledDate, t.ScheduledDate) {
		if err = Exception(ctx, tx, user, t, "moved", now); err != nil {
			return t, err
		}
	}
	return t, Event(ctx, tx, user, zone, "updated", now, &old, t)
}
func CompleteTask(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, old Task, complete, move bool, completed ...*time.Time) (Task, error) {
	status, kind := "incomplete", "reopened"
	var at *time.Time
	if complete {
		status, kind = "complete", "completed"
		v := now.UTC()
		at = &v
		if old.Status == status && old.CompletedAt != nil {
			at = old.CompletedAt
		}
		if len(completed) > 0 && completed[0] != nil {
			v = completed[0].UTC()
			at = &v
		}
		if at.After(now) || at.Year() < 1 {
			return Task{}, Invalid("Completed at must not be in the future")
		}
	}
	if status == old.Status && ((at == nil && old.CompletedAt == nil) || (at != nil && old.CompletedAt != nil && at.Equal(*old.CompletedAt))) {
		return old, nil
	}
	t, err := repository.SaveTaskCompletion(ctx, tx, user, old.ID, status, at, now)
	if err != nil {
		return t, err
	}
	_, err = repository.InvalidateCompletionEvents(ctx, tx, user, old.ID, now)
	if err != nil {
		return t, err
	}
	return t, Event(ctx, tx, user, zone, kind, now, &old, t)
}
func DeleteTask(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, old Task) error {
	_, err := repository.SoftDeleteTask(ctx, tx, user, old.ID, now)
	if err != nil {
		return err
	}
	after := old
	after.Revision++
	after.UpdatedAt = now
	after.DeletedAt = &now
	if err = Exception(ctx, tx, user, after, "deleted", now); err != nil {
		return err
	}
	return Event(ctx, tx, user, zone, "deleted", now, &old, after)
}

func sameDate(a, b *string) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }

// Historical dates are editable; Event adjusts their snapshots atomically.
func EditableDate(ctx context.Context, tx pgx.Tx, user string, date *string) error { return nil }
func Exception(ctx context.Context, tx pgx.Tx, user string, t Task, reason string, now time.Time) error {
	if t.SeriesID == nil {
		return nil
	}
	_, e := repository.UpsertRecurrenceException(ctx, tx, user, t.SeriesID, t.OriginalOccurrenceDate, t.ID, reason, now)
	return e
}
