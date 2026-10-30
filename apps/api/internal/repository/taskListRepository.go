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
 AND ($7 IN ('','all') OR ($7='today' AND scheduled_date=$8::date) OR ($7='upcoming' AND scheduled_date>$8::date)
 OR ($7='overdue' AND status='incomplete' AND deadline<$9) OR ($7='unscheduled' AND scheduled_date IS NULL)
 OR ($7='previously-unfinished' AND status='incomplete' AND scheduled_date<$8::date))
 ORDER BY id LIMIT $10`, userID, cursor, search, priority, status, groupID, view, today, now, limit)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (models.Task, error) { return ScanTask(row) })
}
