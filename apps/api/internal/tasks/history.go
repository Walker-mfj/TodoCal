package tasks

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"time"
)

// Explicit mutations adjust only this task's contribution, preserving other
// tasks' historical state and the original snapshot timezone.
func refreshHistorical(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, before *Task, after Task) error {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return err
	}
	dates := map[string]bool{}
	for _, t := range []*Task{before, &after} {
		if t != nil && t.ScheduledDate != nil {
			dates[*t.ScheduledDate] = true
		}
	}
	for date := range dates {
		if date >= now.In(loc).Format("2006-01-02") {
			var finalized bool
			if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date=$2)`, user, date).Scan(&finalized); err != nil {
				return err
			}
			if !finalized {
				continue
			}
		}
		_, err = tx.Exec(ctx, `INSERT INTO daily_snapshots(user_id,date,timezone,planned,completed,finalized_at) VALUES($1,$2,$3,0,0,$4) ON CONFLICT DO NOTHING`, user, date, zone, now)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM daily_plan_entries WHERE user_id=$1 AND date=$2 AND task_id=$3`, user, date, after.ID)
		if err != nil {
			return err
		}
		if after.DeletedAt == nil && after.ScheduledDate != nil && *after.ScheduledDate == date {
			raw, e := json.Marshal(after)
			if e != nil {
				return e
			}
			_, err = tx.Exec(ctx, `INSERT INTO daily_plan_entries(user_id,date,task_id,task_state) VALUES($1,$2,$3,jsonb_build_object('task',$4::jsonb,'groupName',(SELECT name FROM groups WHERE user_id=$1 AND id=$5),'groupColor',(SELECT color FROM groups WHERE user_id=$1 AND id=$5)))`, user, date, after.ID, raw, after.GroupID)
			if err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `UPDATE daily_snapshots SET planned=(SELECT count(*) FROM daily_plan_entries WHERE user_id=$1 AND date=$2),completed=(SELECT count(*) FROM daily_plan_entries WHERE user_id=$1 AND date=$2 AND task_state->'task'->>'status'='complete'),revision=revision+1 WHERE user_id=$1 AND date=$2`, user, date)
		if err != nil {
			return err
		}
	}
	return nil
}

func GetDeleted(ctx context.Context, tx pgx.Tx, user, id string) (Task, error) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return Task{}, Missing()
	}
	return Scan(tx.QueryRow(ctx, `SELECT `+Columns+` FROM tasks WHERE user_id=$1 AND id=$2 AND deleted_at IS NOT NULL`, user, parsed.String()))
}
func Restore(ctx context.Context, tx pgx.Tx, user, zone, id string, now time.Time, revision int64) (Task, error) {
	old, err := GetDeleted(ctx, tx, user, id)
	if err != nil {
		return Task{}, err
	}
	if old.Revision != revision {
		return Task{}, Conflict()
	}
	t, err := Scan(tx.QueryRow(ctx, `UPDATE tasks SET deleted_at=NULL,updated_at=$3,revision=revision+1 WHERE user_id=$1 AND id=$2 RETURNING `+Columns, user, old.ID, now))
	if err != nil {
		return t, err
	}
	// Keep moved exceptions. Existing task identity also prevents regeneration.
	_, err = tx.Exec(ctx, `DELETE FROM recurrence_exceptions WHERE user_id=$1 AND task_id=$2 AND reason='deleted'`, user, old.ID)
	if err != nil {
		return t, err
	}
	return t, Event(ctx, tx, user, zone, "restored", now, &old, t)
}
