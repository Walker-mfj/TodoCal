package repository

import (
	"context"
	"time"

	"focuscalendar/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func ReadGroupPresentation(ctx context.Context, db DBTX, userID string, groupID *string, resultGroupName **string, resultGroupColor **string) error {
	return db.QueryRow(ctx, `SELECT name,color FROM groups WHERE user_id=$1 AND id=$2`, userID, groupID).Scan(resultGroupName, resultGroupColor)
}

func ListScheduledTasks(ctx context.Context, db DBTX, userID string, date string) ([]models.Task, error) {
	rows, err := db.Query(ctx, `SELECT `+TaskColumns+` FROM tasks WHERE user_id=$1 AND task_local_date(tasks)=$2::date AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM daily_plan_entries p WHERE p.user_id=tasks.user_id AND p.task_id=tasks.id AND p.date<>$2::date) ORDER BY start_time NULLS FIRST,id`, userID, date)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (models.Task, error) { return ScanTask(row) })
}

func ListHistoricalTaskStates(ctx context.Context, db DBTX, userID string, date string, cutoff time.Time, zone string) ([]models.Task, error) {
	rows, err := db.Query(ctx, `WITH latest AS (SELECT DISTINCT ON(task_id) task_id,kind,after_state FROM task_events WHERE user_id=$1 AND (occurred_at<$3 OR historical_adjustment) ORDER BY task_id,occurred_at DESC,(after_state->>'revision')::bigint DESC) SELECT after_state FROM latest WHERE kind<>'deleted' AND NOT EXISTS(SELECT 1 FROM daily_plan_entries p WHERE p.user_id=$1 AND p.task_id=latest.task_id AND p.date<>$2::date) AND COALESCE(((after_state->>'scheduledStartAt')::timestamptz AT TIME ZONE $4)::date,(after_state->>'scheduledDate')::date)=$2::date ORDER BY after_state->>'startTime' NULLS FIRST,task_id`, userID, date, cutoff, zone)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (models.Task, error) { return scanHistoricalTask(row) })
}

func SnapshotExists(ctx context.Context, db DBTX, userID string, date string, resultExists *bool) error {
	return db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date=$2)`, userID, date).Scan(resultExists)
}

func DayHasHistory(ctx context.Context, db DBTX, userID string, date string, resultTouched *bool) error {
	return db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM task_events WHERE user_id=$1 AND after_state->>'scheduledDate'=$2) OR EXISTS(SELECT 1 FROM recurrence_exceptions WHERE user_id=$1 AND original_occurrence_date=$2::date)`, userID, date).Scan(resultTouched)
}

func InsertSnapshot(ctx context.Context, db DBTX, userID string, date string, zone string, planned int, completed int, now time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `INSERT INTO daily_snapshots(user_id,date,timezone,planned,completed,finalized_at) VALUES($1,$2,$3,$4,$5,$6)`, userID, date, zone, planned, completed, now)
}

func InsertSnapshotEntry(ctx context.Context, db DBTX, userID string, date string, taskID string, state []byte) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `INSERT INTO daily_plan_entries(user_id,date,task_id,task_state) VALUES($1,$2,$3,$4)`, userID, date, taskID, state)
}

func ReadPlanningCursor(ctx context.Context, db DBTX, userID string, resultThrough **string) error {
	return db.QueryRow(ctx, `SELECT caught_up_through::text FROM planning_state WHERE user_id=$1`, userID).Scan(resultThrough)
}

// The cursor bounds reconstruction for both journal dates and recurrence dates.
// Unattributed live tasks behind it are settled after reconstruction completes.
func FindFirstUnsettledDate(ctx context.Context, db DBTX, userID string, today string, next *string, resultFirst **string) error {
	return db.QueryRow(ctx, `SELECT min(d)::text FROM (
 SELECT COALESCE(((after_state->>'scheduledStartAt')::timestamptz AT TIME ZONE (SELECT timezone FROM settings WHERE user_id=$1))::date,(after_state->>'scheduledDate')::date) AS d FROM task_events WHERE user_id=$1 AND after_state->>'scheduledDate' IS NOT NULL
 UNION SELECT GREATEST(start_date,COALESCE($3::date,start_date)) FROM recurrence_series WHERE user_id=$1 AND (end_date IS NULL OR end_date>=GREATEST(start_date,COALESCE($3::date,start_date))) AND (stopped_after IS NULL OR stopped_after>=GREATEST(start_date,COALESCE($3::date,start_date)))
 ) candidates WHERE d<$2::date AND ($3::date IS NULL OR d>=$3::date) AND NOT EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date=d)`, userID, today, next).Scan(resultFirst)
}

func AdvancePlanningCursor(ctx context.Context, db DBTX, userID string, through string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `INSERT INTO planning_state(user_id,caught_up_through) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET caught_up_through=GREATEST(planning_state.caught_up_through,EXCLUDED.caught_up_through)`, userID, through)
}

func ReadSnapshotSummary(ctx context.Context, db DBTX, userID string, date string, out *models.Day) error {
	return db.QueryRow(ctx, `SELECT timezone,planned,completed FROM daily_snapshots WHERE user_id=$1 AND date=$2`, userID, date).Scan(&out.Timezone, &out.Planned, &out.Completed)
}

func ListSnapshotEntries(ctx context.Context, db DBTX, userID string, date string) ([]models.Entry, error) {
	rows, err := db.Query(ctx, `SELECT task_state FROM daily_plan_entries WHERE user_id=$1 AND date=$2 ORDER BY task_state->'task'->>'startTime' NULLS FIRST,task_id`, userID, date)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (models.Entry, error) { return scanSnapshotEntry(row) })
}

func ClearInvalidTimeExceptions(ctx context.Context, db DBTX, userID string, today string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `DELETE FROM recurrence_exceptions e WHERE e.user_id=$1 AND e.reason='invalid_local_time' AND e.original_occurrence_date >= $2::date AND NOT EXISTS(SELECT 1 FROM daily_snapshots s WHERE s.user_id=e.user_id AND s.date=e.original_occurrence_date)`, userID, today)
}

// Historical overnight events retain their saved zone even when their reporting
// day is before the requested calendar range.
func ListOverlappingHistoricalDates(ctx context.Context, db DBTX, user, from string) ([]string, error) {
	rows, err := db.Query(ctx, `SELECT DISTINCT p.date::text FROM daily_plan_entries p JOIN daily_snapshots s ON s.user_id=p.user_id AND s.date=p.date WHERE p.user_id=$1 AND p.date<$2::date AND COALESCE((p.task_state->'task'->>'scheduledEndAt')::timestamptz AT TIME ZONE COALESCE(p.task_state->>'timezone',s.timezone), (COALESCE(p.task_state->'task'->>'scheduledEndDate', p.task_state->'task'->>'scheduledDate') || 'T' || (p.task_state->'task'->>'endTime'))::timestamp)>$2::date ORDER BY 1`, user, from)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (string, error) {
		var date string
		err := row.Scan(&date)
		return date, err
	})
}

// Supplemental contributions are accepted live state, not a reconstruction
// limited by a midnight that may precede their creation in the former zone.
func ListUnattributedTasks(ctx context.Context, db DBTX, user, date string) ([]models.Task, error) {
	rows, err := db.Query(ctx, `SELECT `+TaskColumns+` FROM tasks WHERE user_id=$1 AND task_local_date(tasks)=$2::date AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM daily_plan_entries p WHERE p.user_id=tasks.user_id AND p.task_id=tasks.id)`, user, date)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (models.Task, error) { return ScanTask(row) })
}
