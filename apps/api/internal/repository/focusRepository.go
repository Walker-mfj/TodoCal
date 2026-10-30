package repository

import (
	"context"
	"time"

	"focuscalendar/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func CloseFocusInterval(ctx context.Context, db DBTX, userID string, sessionID string, at time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE focus_intervals SET ended_at=$3 WHERE user_id=$1 AND session_id=$2 AND ended_at IS NULL`, userID, sessionID, at)
}

func FindRunningFocus(ctx context.Context, db DBTX, userID string) (*models.FocusSession, error) {
	return ScanFocus(db.QueryRow(ctx, `SELECT `+focusColumns+` FROM focus_sessions WHERE user_id=$1 AND status='running'`, userID))
}

func CompleteFocus(ctx context.Context, db DBTX, userID string, sessionID string, end time.Time, pomodoros int) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE focus_sessions SET status='completed',accumulated_us=target_seconds*1000000,running_since=NULL,ended_at=$3,pomodoros=$4,revision=revision+1 WHERE user_id=$1 AND id=$2`, userID, sessionID, end, pomodoros)
}

func FindActiveFocus(ctx context.Context, db DBTX, userID string) (*models.FocusSession, error) {
	return ScanFocus(db.QueryRow(ctx, `SELECT `+focusColumns+` FROM focus_sessions WHERE user_id=$1 AND status IN ('running','paused')`, userID))
}

func FindLastFocus(ctx context.Context, db DBTX, userID string) (*models.FocusSession, error) {
	return ScanFocus(db.QueryRow(ctx, `SELECT `+focusColumns+` FROM focus_sessions WHERE user_id=$1 AND status IN ('completed','ended') ORDER BY sequence DESC LIMIT 1`, userID))
}

func CountCompletedFocus(ctx context.Context, db DBTX, userID string, resultCompletedFocusSessions *int64) error {
	return db.QueryRow(ctx, `SELECT count(*) FROM focus_sessions WHERE user_id=$1 AND pomodoros=1`, userID).Scan(resultCompletedFocusSessions)
}

func ReadFocusDuration(ctx context.Context, db DBTX, userID string, kind string, resultMinutes *int64) error {
	return db.QueryRow(ctx, `SELECT CASE $2 WHEN 'focus' THEN focus_minutes WHEN 'short_break' THEN short_break_minutes ELSE long_break_minutes END FROM settings WHERE user_id=$1`, userID, kind).Scan(resultMinutes)
}

func InsertFocus(ctx context.Context, db DBTX, userID string, sessionID string, taskID *string, title *string, kind string, targetSeconds int64, now time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `INSERT INTO focus_sessions(user_id,id,task_id,task_title,kind,status,target_seconds,running_since,started_at) VALUES($1,$2,$3,$4,$5,'running',$6,$7,$7)`, userID, sessionID, taskID, title, kind, targetSeconds, now)
}

func InsertFirstFocusInterval(ctx context.Context, db DBTX, userID string, sessionID string, now time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `INSERT INTO focus_intervals(user_id,session_id,ordinal,started_at) VALUES($1,$2,1,$3)`, userID, sessionID, now)
}

func FindFocus(ctx context.Context, db DBTX, userID string, sessionID string) (*models.FocusSession, error) {
	return ScanFocus(db.QueryRow(ctx, `SELECT `+focusColumns+` FROM focus_sessions WHERE user_id=$1 AND id=$2`, userID, sessionID))
}

func SaveStoppedFocus(ctx context.Context, db DBTX, userID string, sessionID string, status string, accumulated int64, endedAt *time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE focus_sessions SET status=$3,accumulated_us=$4,running_since=NULL,ended_at=$5,revision=revision+1 WHERE user_id=$1 AND id=$2`, userID, sessionID, status, accumulated, endedAt)
}

func AppendFocusInterval(ctx context.Context, db DBTX, userID string, sessionID string, now time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `INSERT INTO focus_intervals(user_id,session_id,ordinal,started_at) SELECT $1,$2,COALESCE(max(ordinal),0)+1,$3 FROM focus_intervals WHERE user_id=$1 AND session_id=$2`, userID, sessionID, now)
}

func ResumeFocus(ctx context.Context, db DBTX, userID string, sessionID string, now time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE focus_sessions SET status='running',running_since=$3,revision=revision+1 WHERE user_id=$1 AND id=$2`, userID, sessionID, now)
}

func TaskExists(ctx context.Context, db DBTX, userID string, taskID string, resultExists *bool) error {
	return db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tasks WHERE user_id=$1 AND id=$2)`, userID, taskID).Scan(resultExists)
}

func ListTaskFocusSessions(ctx context.Context, db DBTX, userID string, taskID string) ([]*models.FocusSession, error) {
	rows, err := db.Query(ctx, `SELECT `+focusColumns+` FROM focus_sessions WHERE user_id=$1 AND task_id=$2 AND kind='focus' ORDER BY sequence DESC`, userID, taskID)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (*models.FocusSession, error) { return ScanFocus(row) })
}
