package services

import (
	"context"
	"errors"
	"time"

	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Schedule = models.Schedule
type UndoToken = models.UndoToken
type Scheduled = models.Scheduled

func Reschedule(ctx context.Context, tx pgx.Tx, user, zone, id string, now time.Time, schedule Schedule, revision int64) (Scheduled, error) {
	var out Scheduled
	old, err := GetTask(ctx, tx, user, id)
	if err != nil {
		return out, err
	}
	if old.Revision != revision {
		return out, Conflict()
	}
	in := old.TaskInput
	in.ScheduledDate = schedule.ScheduledDate
	in.StartTime = schedule.StartTime
	in.EndTime = schedule.EndTime
	in.ScheduledEndDate = schedule.ScheduledEndDate
	if err = Validate(&in, zone, now, &old); err != nil {
		return out, err
	}
	// A scheduling command must never mutate a finalized plan, including same-date time changes.
	if err = EditableDate(ctx, tx, user, in.ScheduledDate); err != nil {
		return out, err
	}
	out.Task, err = UpdateTask(ctx, tx, user, zone, now, old, in)
	if err != nil {
		return out, err
	}
	out.ServerNow = now.UTC()
	out.Undo = UndoToken{ID: uuid.NewString(), ExpiresAt: now.Add(10 * time.Second).UTC()}
	_, err = repository.InsertScheduleUndo(ctx, tx, user, out.Undo.ID, old.ID, old.ScheduledDate, old.StartTime, old.EndTime, out.Task.Revision, now, out.Undo.ExpiresAt, old.ScheduledEndDate, old.ScheduledStartAt, old.ScheduledEndAt)
	return out, err
}
func UndoSchedule(ctx context.Context, tx pgx.Tx, user, zone, id string, now time.Time) (Task, error) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return Task{}, Missing()
	}
	var taskID string
	var revision int64
	var previous Task
	var expires time.Time
	var consumed *time.Time
	err = repository.ReadScheduleUndo(ctx, tx, user, parsed.String(), &taskID, &previous.ScheduledDate, &previous.StartTime, &previous.EndTime, &revision, &expires, &consumed, &previous.ScheduledEndDate, &previous.ScheduledStartAt, &previous.ScheduledEndAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, Missing()
	}
	if err != nil {
		return Task{}, err
	}
	if consumed != nil || !now.Before(expires) {
		return Task{}, &Fault{Code: "undo_expired", Message: "This undo is no longer available"}
	}
	old, err := GetTask(ctx, tx, user, taskID)
	if err != nil {
		return Task{}, err
	}
	if old.Revision != revision {
		return Task{}, Conflict()
	}
	if err = EditableDate(ctx, tx, user, previous.ScheduledDate); err != nil {
		return Task{}, err
	}
	previous = projectTask(previous, zone)
	in := old.TaskInput
	in.ScheduledEndDate = previous.ScheduledEndDate
	in.ScheduledDate = previous.ScheduledDate
	in.StartTime = previous.StartTime
	in.EndTime = previous.EndTime
	restored, err := UpdateTask(ctx, tx, user, zone, now, old, in, previous.ScheduledStartAt, previous.ScheduledEndAt)
	if err != nil {
		return Task{}, err
	}
	_, err = repository.ConsumeScheduleUndo(ctx, tx, user, parsed.String(), now)
	return restored, err
}
