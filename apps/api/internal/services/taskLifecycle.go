package services

import (
	"context"
	"time"

	"focuscalendar/internal/repository"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func GetTask(ctx context.Context, tx pgx.Tx, user, id string) (Task, error) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return Task{}, Missing()
	}
	id = parsed.String()
	return repository.FindTask(ctx, tx, user, id)
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
