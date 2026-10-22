package tasks

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"time"
)

type Schedule struct {
	ScheduledDate *string `json:"scheduledDate"`
	StartTime     *string `json:"startTime"`
	EndTime       *string `json:"endTime"`
}
type UndoToken struct {
	ID        string    `json:"id"`
	ExpiresAt time.Time `json:"expiresAt"`
}
type Scheduled struct {
	Task      Task      `json:"task"`
	Undo      UndoToken `json:"undo"`
	ServerNow time.Time `json:"serverNow"`
}

func Reschedule(ctx context.Context, tx pgx.Tx, user, zone, id string, now time.Time, schedule Schedule, revision int64) (Scheduled, error) {
	var out Scheduled
	old, err := Get(ctx, tx, user, id)
	if err != nil {
		return out, err
	}
	if old.Revision != revision {
		return out, Conflict()
	}
	in := old.Input
	in.ScheduledDate = schedule.ScheduledDate
	in.StartTime = schedule.StartTime
	in.EndTime = schedule.EndTime
	if err = Validate(&in, zone, now, &old); err != nil {
		return out, err
	}
	// A scheduling command must never mutate a finalized plan, including same-date time changes.
	if err = EditableDate(ctx, tx, user, in.ScheduledDate); err != nil {
		return out, err
	}
	out.Task, err = Update(ctx, tx, user, zone, now, old, in)
	if err != nil {
		return out, err
	}
	out.ServerNow = now.UTC()
	out.Undo = UndoToken{ID: uuid.NewString(), ExpiresAt: now.Add(10 * time.Second).UTC()}
	_, err = tx.Exec(ctx, `INSERT INTO schedule_undos(user_id,id,task_id,previous_date,previous_start,previous_end,resulting_revision,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, user, out.Undo.ID, old.ID, old.ScheduledDate, old.StartTime, old.EndTime, out.Task.Revision, now, out.Undo.ExpiresAt)
	return out, err
}
func UndoSchedule(ctx context.Context, tx pgx.Tx, user, zone, id string, now time.Time) (Task, error) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return Task{}, Missing()
	}
	var taskID string
	var revision int64
	var previous Schedule
	var expires time.Time
	var consumed *time.Time
	err = tx.QueryRow(ctx, `SELECT task_id::text,previous_date::text,to_char(previous_start,'HH24:MI'),to_char(previous_end,'HH24:MI'),resulting_revision,expires_at,consumed_at FROM schedule_undos WHERE user_id=$1 AND id=$2`, user, parsed.String()).Scan(&taskID, &previous.ScheduledDate, &previous.StartTime, &previous.EndTime, &revision, &expires, &consumed)
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, Missing()
	}
	if err != nil {
		return Task{}, err
	}
	if consumed != nil || !now.Before(expires) {
		return Task{}, &Fault{409, "undo_expired", "This undo is no longer available"}
	}
	old, err := Get(ctx, tx, user, taskID)
	if err != nil {
		return Task{}, err
	}
	if old.Revision != revision {
		return Task{}, Conflict()
	}
	if err = EditableDate(ctx, tx, user, previous.ScheduledDate); err != nil {
		return Task{}, err
	}
	in := old.Input
	in.ScheduledDate = previous.ScheduledDate
	in.StartTime = previous.StartTime
	in.EndTime = previous.EndTime
	restored, err := Update(ctx, tx, user, zone, now, old, in)
	if err != nil {
		return Task{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE schedule_undos SET consumed_at=$3 WHERE user_id=$1 AND id=$2`, user, parsed.String(), now)
	return restored, err
}
