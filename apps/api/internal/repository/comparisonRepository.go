package repository

import (
	"context"
	"encoding/json"
	"focuscalendar/internal/models"
	"github.com/jackc/pgx/v5"
	"time"
)

// Comparisons use each accepted entry's timezone, while unowned journal states
// retain the reporting timezone. State still comes from the comparison cutoff.
func ListComparisonTaskStates(ctx context.Context, db DBTX, user, date, zone string, cutoff time.Time) ([]models.Entry, error) {
	rows, err := db.Query(ctx, `WITH latest AS (
 SELECT DISTINCT ON(task_id) task_id,kind,after_state FROM task_events
 WHERE user_id=$1 AND (occurred_at<$3 OR historical_adjustment)
 ORDER BY task_id,occurred_at DESC,(after_state->>'revision')::bigint DESC
 ), attributed AS (
 SELECT l.*,COALESCE(p.task_state->>'timezone',s.timezone,$4) AS zone
 FROM latest l
 LEFT JOIN daily_plan_entries p ON p.user_id=$1 AND p.task_id=l.task_id AND p.date=$2::date
 LEFT JOIN daily_snapshots s ON s.user_id=p.user_id AND s.date=p.date
 WHERE NOT EXISTS(SELECT 1 FROM daily_plan_entries other WHERE other.user_id=$1 AND other.task_id=l.task_id AND other.date<>$2::date)
 ) SELECT after_state,zone FROM attributed WHERE kind<>'deleted'
 AND COALESCE(((after_state->>'scheduledStartAt')::timestamptz AT TIME ZONE zone)::date,(after_state->>'scheduledDate')::date)=$2::date
 ORDER BY after_state->>'startTime' NULLS FIRST,task_id`, user, date, cutoff, zone)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (models.Entry, error) {
		var entry models.Entry
		var raw []byte
		if err := row.Scan(&raw, &entry.Timezone); err != nil {
			return entry, err
		}
		err := json.Unmarshal(raw, &entry.Task)
		return entry, err
	})
}
