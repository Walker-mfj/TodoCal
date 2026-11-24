package repository

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func InsertScheduleUndo(ctx context.Context, db DBTX, userID string, undoID string, taskID string, previousDate *string, previousStart *string, previousEnd *string, revision int64, now time.Time, expiresAt time.Time, previousEndDate *string, startAt, endAt *time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `INSERT INTO schedule_undos(user_id,id,task_id,previous_date,previous_start,previous_end,resulting_revision,created_at,expires_at,previous_end_date,previous_start_at,previous_end_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, userID, undoID, taskID, previousDate, previousStart, previousEnd, revision, now, expiresAt, previousEndDate, startAt, endAt)
}

func ReadScheduleUndo(ctx context.Context, db DBTX, userID string, undoID string, resultTaskID *string, resultScheduledDate **string, resultStartTime **string, resultEndTime **string, resultRevision *int64, resultExpires *time.Time, resultConsumed **time.Time, resultEndDate **string, resultStartAt, resultEndAt **time.Time) error {
	return db.QueryRow(ctx, `SELECT task_id::text,previous_date::text,to_char(previous_start,'HH24:MI'),to_char(previous_end,'HH24:MI'),resulting_revision,expires_at,consumed_at,previous_end_date::text,previous_start_at,previous_end_at FROM schedule_undos WHERE user_id=$1 AND id=$2`, userID, undoID).Scan(resultTaskID, resultScheduledDate, resultStartTime, resultEndTime, resultRevision, resultExpires, resultConsumed, resultEndDate, resultStartAt, resultEndAt)
}

func ConsumeScheduleUndo(ctx context.Context, db DBTX, userID string, undoID string, now time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE schedule_undos SET consumed_at=$3 WHERE user_id=$1 AND id=$2`, userID, undoID, now)
}
