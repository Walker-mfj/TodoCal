package services

import (
	"context"
	"focuscalendar/internal/localdate"
	"github.com/jackc/pgx/v5"
	"time"
)

// MaterializeReminderHorizon covers starts and deadlines independently: a
// recurring deadline can precede its scheduled task by more than the lead time.
func MaterializeReminderHorizon(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time) error {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return err
	}
	today := now.In(loc).Format("2006-01-02")
	// A 24-hour lead may span two local dates on a short DST day.
	if err = Materialize(ctx, tx, user, zone, today, localdate.Add(today, 3), now); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT DISTINCT r.deadline_offset FROM recurrence_series r
 JOIN notification_preferences p ON p.user_id=r.user_id
 WHERE r.user_id=$1 AND p.deadline AND r.deadline_offset<0`, user)
	if err != nil {
		return err
	}
	var offsets []int
	for rows.Next() {
		var offset int
		if err = rows.Scan(&offset); err != nil {
			rows.Close()
			return err
		}
		offsets = append(offsets, offset)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, offset := range offsets {
		// Include delayed candidates from the preceding 24 elapsed hours,
		// which can span two local dates around DST.
		from := localdate.Add(today, -offset-2)
		to := localdate.Add(today, -offset+3)
		// A deadline near the last supported year can imply a range outside it.
		if _, err := localdate.Parse(from); err != nil {
			continue
		}
		if _, err := localdate.Parse(to); err != nil {
			continue
		}
		if err = Materialize(ctx, tx, user, zone, from, to, now); err != nil {
			return err
		}
	}
	return nil
}
