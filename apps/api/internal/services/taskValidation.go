package services

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type TaskInput = models.TaskInput

type Task = models.Task

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
	_, err := time.LoadLocation(zone)
	if err != nil {
		return err
	}
	if in.ScheduledDate != nil {
		d, e := time.Parse("2006-01-02", *in.ScheduledDate)
		if e != nil || d.Year() < 1 || d.Format("2006-01-02") != *in.ScheduledDate {
			return Invalid("Use a valid scheduled date")
		}

	}
	if in.StartTime == nil && in.EndTime == nil {
		in.ScheduledEndDate = nil
	} else if in.ScheduledEndDate == nil {
		in.ScheduledEndDate = in.ScheduledDate
	}
	if _, _, err := taskInstants(*in, zone, previous); err != nil {
		return err
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

// Historical dates are editable; Event adjusts their snapshots atomically.
func EditableDate(ctx context.Context, tx pgx.Tx, user string, date *string) error { return nil }
