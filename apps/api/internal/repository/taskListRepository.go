package repository

import (
	"context"
	"time"

	"focuscalendar/internal/models"

	"github.com/jackc/pgx/v5"
)

func ListTasks(ctx context.Context, db DBTX, userID string, cursor string, search string, priority string, status string, groupID string, view string, today string, now time.Time, limit int) ([]models.Task, error) {
	rows, err := db.Query(ctx, `SELECT `+TaskColumns+` FROM tasks WHERE user_id=$1 AND deleted_at IS NULL
 AND ($2='' OR id>NULLIF($2,'')::uuid) AND ($3='' OR strpos(lower(title),lower($3))>0)
 AND ($4='' OR priority=$4) AND ($5='' OR status=$5)
 AND ($6='' OR ($6='none' AND group_id IS NULL) OR group_id=NULLIF(NULLIF($6,'none'),'')::uuid)
 AND ($7 IN ('','all') OR ($7='today' AND task_local_date(tasks)=$8::date) OR ($7='upcoming' AND task_local_date(tasks)>$8::date)
 OR ($7='overdue' AND status='incomplete' AND deadline<$9) OR ($7='unscheduled' AND scheduled_date IS NULL)
 OR ($7='previously-unfinished' AND status='incomplete' AND task_local_date(tasks)<$8::date))
 ORDER BY id LIMIT $10`, userID, cursor, search, priority, status, groupID, view, today, now, limit)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (models.Task, error) { return ScanTask(row) })
}

// Half-open overlap includes overnight events beginning before the visible range.
func ListCalendarTasks(ctx context.Context, db DBTX, user, from, to string, start, end time.Time) ([]models.Task, error) {
	rows, err := db.Query(ctx, `SELECT `+TaskColumns+` FROM tasks WHERE user_id=$1 AND deleted_at IS NULL AND (
 (scheduled_start_at IS NOT NULL AND scheduled_start_at<$5 AND scheduled_end_at>$4)
 OR (scheduled_start_at IS NULL AND scheduled_date >= $2::date AND scheduled_date<$3::date)) ORDER BY task_local_date(tasks),scheduled_start_at NULLS FIRST,start_time NULLS FIRST,id`, user, from, to, start, end)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (models.Task, error) { return ScanTask(row) })
}
