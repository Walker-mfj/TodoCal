package repository

import (
	"context"
	"time"

	"focuscalendar/internal/models"

	"github.com/jackc/pgx/v5/pgconn"
)

func FindTask(ctx context.Context, db DBTX, userID string, taskID string) (models.Task, error) {
	return ScanTask(db.QueryRow(ctx, `SELECT `+TaskColumns+` FROM tasks WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL`, userID, taskID))
}

func GroupExists(ctx context.Context, db DBTX, userID string, groupID string, resultExists *bool) error {
	return db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM groups WHERE user_id=$1 AND id=$2)`, userID, groupID).Scan(resultExists)
}

func InsertTaskEvent(ctx context.Context, db DBTX, userID string, eventID string, taskID string, kind string, now time.Time, date string, zone string, before []byte, after []byte, historical bool) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `INSERT INTO task_events(user_id,id,task_id,kind,occurred_at,local_date,timezone,before_state,after_state,historical_adjustment) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, userID, eventID, taskID, kind, now, date, zone, before, after, historical)
}

func InsertTask(ctx context.Context, db DBTX, userID string, taskID string, title string, description string, groupID *string, priority string, scheduledDate *string, startTime *string, endTime *string, deadline *time.Time, estimatedPomodoros *int, now time.Time, focusMinutes *int, scheduledEndDate *string, startAt, endAt *time.Time) (models.Task, error) {
	return ScanTask(db.QueryRow(ctx, `INSERT INTO tasks(user_id,id,title,description,group_id,priority,scheduled_date,start_time,end_time,deadline,estimated_pomodoros,created_at,updated_at,focus_minutes,scheduled_end_date,scheduled_start_at,scheduled_end_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14,$15,$16) RETURNING `+TaskColumns, userID, taskID, title, description, groupID, priority, scheduledDate, startTime, endTime, deadline, estimatedPomodoros, now, focusMinutes, scheduledEndDate, startAt, endAt))
}

func UpdateTask(ctx context.Context, db DBTX, userID string, taskID string, title string, description string, groupID *string, priority string, scheduledDate *string, startTime *string, endTime *string, deadline *time.Time, estimatedPomodoros *int, now time.Time, focusMinutes *int, scheduledEndDate *string, startAt, endAt *time.Time) (models.Task, error) {
	return ScanTask(db.QueryRow(ctx, `UPDATE tasks SET title=$3,description=$4,group_id=$5,priority=$6,scheduled_date=$7,start_time=$8,end_time=$9,deadline=$10,estimated_pomodoros=$11,focus_minutes=$13,scheduled_end_date=$14,scheduled_start_at=$15,scheduled_end_at=$16,revision=revision+1,updated_at=$12 WHERE user_id=$1 AND id=$2 RETURNING `+TaskColumns, userID, taskID, title, description, groupID, priority, scheduledDate, startTime, endTime, deadline, estimatedPomodoros, now, focusMinutes, scheduledEndDate, startAt, endAt))
}

func SaveTaskCompletion(ctx context.Context, db DBTX, userID string, taskID string, status string, completedAt *time.Time, now time.Time) (models.Task, error) {
	return ScanTask(db.QueryRow(ctx, `UPDATE tasks SET status=$3,completed_at=$4,revision=revision+1,updated_at=$5 WHERE user_id=$1 AND id=$2 RETURNING `+TaskColumns, userID, taskID, status, completedAt, now))
}

func InvalidateCompletionEvents(ctx context.Context, db DBTX, userID string, taskID string, now time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE task_events SET invalidated_at=$3 WHERE user_id=$1 AND task_id=$2 AND kind='completed' AND invalidated_at IS NULL`, userID, taskID, now)
}

func SoftDeleteTask(ctx context.Context, db DBTX, userID string, taskID string, now time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE tasks SET deleted_at=$3,updated_at=$3,revision=revision+1 WHERE user_id=$1 AND id=$2`, userID, taskID, now)
}

func UpsertRecurrenceException(ctx context.Context, db DBTX, userID string, seriesID *string, date *string, taskID string, reason string, now time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `INSERT INTO recurrence_exceptions(user_id,series_id,original_occurrence_date,task_id,reason,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,series_id,original_occurrence_date) DO UPDATE SET reason=EXCLUDED.reason`, userID, seriesID, date, taskID, reason, now)
}
