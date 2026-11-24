package services

import (
	"context"
	"focuscalendar/internal/localdate"
	"github.com/jackc/pgx/v5"
	"time"
)

// MaterializeSeriesReminderHorizon bounds a durable batch to one series and at
// a bounded range of local dates, independent of the account's total series count.
func MaterializeSeriesReminderHorizon(ctx context.Context, tx pgx.Tx, user, zone, series string, now time.Time) error {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return err
	}
	today := now.In(loc).Format("2006-01-02")
	if err = materializeSelected(ctx, tx, user, zone, today, localdate.Add(today, 3), now, series); err != nil {
		return err
	}
	var offset *int
	err = tx.QueryRow(ctx, `SELECT CASE WHEN p.deadline THEN r.deadline_offset END
 FROM recurrence_series r JOIN notification_preferences p ON p.user_id=r.user_id
 WHERE r.user_id=$1 AND r.id=$2`, user, series).Scan(&offset)
	if err != nil {
		return err
	}
	if offset == nil || *offset >= 0 {
		return nil
	}
	from, to := localdate.Add(today, -*offset-2), localdate.Add(today, -*offset+3)
	if _, err = localdate.Parse(from); err != nil {
		return nil
	}
	if _, err = localdate.Parse(to); err != nil {
		return nil
	}
	return materializeSelected(ctx, tx, user, zone, from, to, now, series)
}
