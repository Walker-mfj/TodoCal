package repository

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

func ListCompletedTaskIDs(ctx context.Context, db DBTX, userID string, date string, cutoff time.Time, zone string) ([]string, error) {
	rows, err := db.Query(ctx, `SELECT id::text FROM tasks WHERE user_id=$1 AND status='complete' AND deleted_at IS NULL AND (completed_at AT TIME ZONE $4)::date=$2::date AND completed_at<=$3 ORDER BY id::text`, userID, date, cutoff, zone)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (string, error) { return scanString(row) })
}

func ListFocusIntervals(ctx context.Context, db DBTX, userID string, start time.Time, end time.Time) ([]FocusInterval, error) {
	rows, err := db.Query(ctx, `SELECT s.id::text,s.task_title,s.status,s.target_seconds,s.accumulated_us,s.ended_at,s.pomodoros,i.started_at,i.ended_at FROM focus_sessions s JOIN focus_intervals i ON i.user_id=s.user_id AND i.session_id=s.id WHERE s.user_id=$1 AND s.kind='focus' AND i.started_at<=$3 AND (COALESCE(i.ended_at,$3)>=$2 OR s.ended_at>=$2) ORDER BY s.sequence,i.ordinal`, userID, start, end)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (FocusInterval, error) { return scanFocusInterval(row) })
}
