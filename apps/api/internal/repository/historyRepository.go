package repository

import (
	"context"
	"time"

	"focuscalendar/internal/models"

	"github.com/jackc/pgx/v5/pgconn"
)

func HistoricalSnapshotExists(ctx context.Context, db DBTX, userID string, date string, resultFinalized *bool) error {
	return db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date=$2)`, userID, date).Scan(resultFinalized)
}

func EnsureSnapshot(ctx context.Context, db DBTX, userID string, date string, zone string, now time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `INSERT INTO daily_snapshots(user_id,date,timezone,planned,completed,finalized_at) VALUES($1,$2,$3,0,0,$4) ON CONFLICT DO NOTHING`, userID, date, zone, now)
}

func DeleteSnapshotEntry(ctx context.Context, db DBTX, userID string, date string, taskID string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `DELETE FROM daily_plan_entries WHERE user_id=$1 AND date=$2 AND task_id=$3`, userID, date, taskID)
}

func InsertHistoricalEntry(ctx context.Context, db DBTX, userID string, date string, taskID string, state []byte, groupID *string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `INSERT INTO daily_plan_entries(user_id,date,task_id,task_state) VALUES($1,$2,$3,jsonb_build_object('task',$4::jsonb,'groupName',(SELECT name FROM groups WHERE user_id=$1 AND id=$5),'groupColor',(SELECT color FROM groups WHERE user_id=$1 AND id=$5)))`, userID, date, taskID, state, groupID)
}

func RecountSnapshot(ctx context.Context, db DBTX, userID string, date string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE daily_snapshots SET planned=(SELECT count(*) FROM daily_plan_entries WHERE user_id=$1 AND date=$2),completed=(SELECT count(*) FROM daily_plan_entries WHERE user_id=$1 AND date=$2 AND task_state->'task'->>'status'='complete'),revision=revision+1 WHERE user_id=$1 AND date=$2`, userID, date)
}

func FindDeletedTask(ctx context.Context, db DBTX, userID string, taskID string) (models.Task, error) {
	return ScanTask(db.QueryRow(ctx, `SELECT `+TaskColumns+` FROM tasks WHERE user_id=$1 AND id=$2 AND deleted_at IS NOT NULL`, userID, taskID))
}

func RestoreTask(ctx context.Context, db DBTX, userID string, taskID string, now time.Time) (models.Task, error) {
	return ScanTask(db.QueryRow(ctx, `UPDATE tasks SET deleted_at=NULL,updated_at=$3,revision=revision+1 WHERE user_id=$1 AND id=$2 RETURNING `+TaskColumns, userID, taskID, now))
}

func DeleteTaskDeletionException(ctx context.Context, db DBTX, userID string, taskID string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `DELETE FROM recurrence_exceptions WHERE user_id=$1 AND task_id=$2 AND reason='deleted'`, userID, taskID)
}
