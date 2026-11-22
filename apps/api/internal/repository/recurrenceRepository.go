package repository

import (
	"context"
	"time"

	"focuscalendar/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func InsertSeries(ctx context.Context, db DBTX, userID string, seriesID string, template []byte, groupID *string, startDate *string, cadence string, intervalDays int, endDate *string, deadlineOffset *int, deadlineTime *string, now time.Time, zone string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `INSERT INTO recurrence_series(user_id,id,template,group_id,start_date,cadence,interval_days,end_date,deadline_offset,deadline_time,created_at,timezone) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, userID, seriesID, template, groupID, startDate, cadence, intervalDays, endDate, deadlineOffset, deadlineTime, now, zone)
}

func ListMaterializableSeries(ctx context.Context, db DBTX, userID string, from string, to string, selected ...string) ([]models.Series, error) {
	var series any
	if len(selected) > 0 && selected[0] != "" {
		series = selected[0]
	}
	rows, err := db.Query(ctx, `SELECT id::text,template,group_id::text,start_date::text,cadence,interval_days,end_date::text,stopped_after::text,deadline_offset,deadline_time,created_at,schedule_offset_days,timezone FROM recurrence_series WHERE user_id=$1 AND ($4::uuid IS NULL OR id=$4::uuid) AND start_date+schedule_offset_days<$3::date AND (end_date IS NULL OR end_date+schedule_offset_days+COALESCE((template->>'scheduledEndDate')::date-(template->>'scheduledDate')::date,0)>=$2::date) AND (stopped_after IS NULL OR stopped_after>=$2::date)`, userID, from, to, series)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (models.Series, error) { return scanMaterializableSeries(row) })
}

func OccurrenceIsMaterialized(ctx context.Context, db DBTX, userID string, seriesID string, original string, date string, explicit string, resultExists *bool) error {
	return db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM recurrence_series WHERE user_id=$1 AND id=$2 AND original_cutoff <= $3::date) OR EXISTS(SELECT 1 FROM tasks WHERE user_id=$1 AND series_id=$2 AND original_occurrence_date=$3) OR EXISTS(SELECT 1 FROM recurrence_exceptions WHERE user_id=$1 AND series_id=$2 AND original_occurrence_date=$3) OR ($2::text<>$5 AND EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date=$4))`, userID, seriesID, original, date, explicit).Scan(resultExists)
}

func InsertInvalidTimeException(ctx context.Context, db DBTX, userID string, seriesID string, date string, now time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `INSERT INTO recurrence_exceptions(user_id,series_id,original_occurrence_date,reason,created_at) VALUES($1,$2,$3,'invalid_local_time',$4) ON CONFLICT DO NOTHING`, userID, seriesID, date, now)
}

func InsertOccurrence(ctx context.Context, db DBTX, userID string, taskID string, title string, description string, groupID *string, priority string, date string, startTime *string, endTime *string, deadline *time.Time, estimatedPomodoros *int, now time.Time, seriesID string, original string, focusMinutes *int, endDate *string, startAt, endAt *time.Time) (models.Task, error) {
	return ScanTask(db.QueryRow(ctx, `INSERT INTO tasks(user_id,id,title,description,group_id,priority,scheduled_date,start_time,end_time,deadline,estimated_pomodoros,created_at,updated_at,series_id,original_occurrence_date,focus_minutes,scheduled_end_date,scheduled_start_at,scheduled_end_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14,$15,$16,$17,$18) RETURNING `+TaskColumns, userID, taskID, title, description, groupID, priority, date, startTime, endTime, deadline, estimatedPomodoros, now, seriesID, original, focusMinutes, endDate, startAt, endAt))
}

func ReadSeriesStopState(ctx context.Context, db DBTX, userID string, seriesID string, resultRev *int64, resultStopped **string) error {
	return db.QueryRow(ctx, `SELECT revision,stopped_after::text FROM recurrence_series WHERE user_id=$1 AND id=$2`, userID, seriesID).Scan(resultRev, resultStopped)
}

func StopSeries(ctx context.Context, db DBTX, userID string, seriesID string, after string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE recurrence_series SET stopped_after=$3,revision=revision+1 WHERE user_id=$1 AND id=$2`, userID, seriesID, after)
}

func ListStoppableTasks(ctx context.Context, db DBTX, userID string, seriesID string, after string, zone string) ([]models.Task, error) {
	rows, err := db.Query(ctx, `SELECT `+TaskColumns+` FROM tasks WHERE user_id=$1 AND series_id=$2 AND (COALESCE((scheduled_start_at AT TIME ZONE $4)::date,scheduled_date)>$3::date OR (scheduled_date IS NULL AND original_occurrence_date>$3::date)) AND status='incomplete' AND deleted_at IS NULL`, userID, seriesID, after, zone)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (models.Task, error) { return ScanTask(row) })
}

func SaveSeriesStopUndo(ctx context.Context, db DBTX, userID string, seriesID string, undo []byte) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE recurrence_series SET stop_undo=$3 WHERE user_id=$1 AND id=$2`, userID, seriesID, undo)
}

func ReadSeries(ctx context.Context, db DBTX, userID string, seriesID string, resultID *string, resultRaw *[]byte, resultGroup **string, resultCadence *string, resultIntervalDays *int, resultEndDate **string, resultStoppedAfter **string, resultRevision *int64, resultCreatedAt *time.Time, resultScheduleOffset *int, resultOffset **int, resultDeadlineTime **string) error {
	return db.QueryRow(ctx, `SELECT id::text,template,group_id::text,cadence,interval_days,end_date::text,stopped_after::text,revision,created_at,schedule_offset_days,deadline_offset,deadline_time FROM recurrence_series WHERE user_id=$1 AND id=$2`, userID, seriesID).Scan(resultID, resultRaw, resultGroup, resultCadence, resultIntervalDays, resultEndDate, resultStoppedAfter, resultRevision, resultCreatedAt, resultScheduleOffset, resultOffset, resultDeadlineTime)
}

func ListEditableOccurrences(ctx context.Context, db DBTX, userID string, seriesID string, today string, zone string) ([]models.Task, error) {
	rows, err := db.Query(ctx, `SELECT `+TaskColumns+` FROM tasks WHERE user_id=$1 AND series_id=$2 AND deleted_at IS NULL AND COALESCE((scheduled_start_at AT TIME ZONE $4)::date,scheduled_date) >= $3::date AND NOT EXISTS (SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date=task_local_date(tasks))`, userID, seriesID, today, zone)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (models.Task, error) { return ScanTask(row) })
}

func ReadSeriesStartDate(ctx context.Context, db DBTX, userID string, seriesID string, resultAnchor *string) error {
	return db.QueryRow(ctx, `SELECT start_date::text FROM recurrence_series WHERE user_id=$1 AND id=$2`, userID, seriesID).Scan(resultAnchor)
}

func UpdateSeriesTemplate(ctx context.Context, db DBTX, userID string, seriesID string, template []byte, groupID *string, deadlineOffset *int, deadlineTime *string, scheduleOffset int) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE recurrence_series SET template=$3,group_id=$4,deadline_offset=$5,deadline_time=$6,schedule_offset_days=$7,revision=revision+1 WHERE user_id=$1 AND id=$2`, userID, seriesID, template, groupID, deadlineOffset, deadlineTime, scheduleOffset)
}

func ClearShiftedInvalidTimeExceptions(ctx context.Context, db DBTX, userID string, seriesID string, scheduleOffset int, today string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `DELETE FROM recurrence_exceptions WHERE user_id=$1 AND series_id=$2 AND reason='invalid_local_time' AND original_occurrence_date+$3::integer >= $4::date`, userID, seriesID, scheduleOffset, today)
}

func ReadSeriesStopUndo(ctx context.Context, db DBTX, userID string, seriesID string, resultRaw *[]byte) error {
	return db.QueryRow(ctx, `SELECT stop_undo FROM recurrence_series WHERE user_id=$1 AND id=$2`, userID, seriesID).Scan(resultRaw)
}

func ClearSeriesStop(ctx context.Context, db DBTX, userID string, seriesID string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE recurrence_series SET stopped_after=NULL,stop_undo=NULL,revision=revision+1 WHERE user_id=$1 AND id=$2`, userID, seriesID)
}
