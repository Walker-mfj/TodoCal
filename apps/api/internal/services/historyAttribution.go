package services

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
)

// Keep deletion provenance in the journal even after the reporting entry is
// removed. A snapshot for the date alone does not prove task attribution.
type deletionState struct {
	Task
	HistoricalAttribution map[string]string `json:"historicalAttribution,omitempty"`
}

func deletionAttribution(ctx context.Context, tx pgx.Tx, user, task string) (map[string]string, error) {
	rows, err := tx.Query(ctx, `SELECT p.date::text,COALESCE(p.task_state->>'timezone',s.timezone) FROM daily_plan_entries p JOIN daily_snapshots s ON s.user_id=p.user_id AND s.date=p.date WHERE p.user_id=$1 AND p.task_id=$2`, user, task)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var date, zone string
		if err = rows.Scan(&date, &zone); err != nil {
			return nil, err
		}
		out[date] = zone
	}
	return out, rows.Err()
}

func restoredAttribution(ctx context.Context, tx pgx.Tx, user string, before Task) (map[string]string, error) {
	var raw []byte
	err := tx.QueryRow(ctx, `SELECT after_state FROM task_events WHERE user_id=$1 AND task_id=$2 AND kind='deleted' ORDER BY occurred_at DESC,(after_state->>'revision')::bigint DESC LIMIT 1`, user, before.ID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var saved deletionState
	if err = json.Unmarshal(raw, &saved); err != nil {
		return nil, err
	}
	// Never reuse provenance from an earlier deletion or a different schedule.
	// PostgreSQL stores timestamps at microsecond precision; journal JSON may
	// retain nanoseconds from the command clock.
	if saved.DeletedAt == nil || before.DeletedAt == nil || saved.DeletedAt.UnixMicro() != before.DeletedAt.UnixMicro() || !sameScheduledStart(saved.Task, before) {
		return nil, nil
	}
	return saved.HistoricalAttribution, nil
}
