package services

import (
	"context"
	"time"
)

// NextDue separates unqueued per-device candidates from delivery retries. A
// missing sender disables only delivery; Focus settlement still runs.
func (w NotificationWorker) NextDue(ctx context.Context) (time.Time, error) {
	if w.Sender == nil {
		return time.Time{}, nil
	}
	window := ""
	if w.EnforceLateness {
		window = notificationCandidateWindow
	}
	var due *time.Time
	err := w.Pool.QueryRow(ctx, `SELECT min(due) FROM (
 SELECT min(c.due_at) AS due FROM notification_candidates c
 JOIN push_subscriptions s ON s.user_id=c.user_id
 JOIN auth_sessions a ON a.id=s.session_id
 JOIN notification_preferences p ON p.user_id=c.user_id
 WHERE s.revoked_at IS NULL AND a.revoked_at IS NULL
 AND c.due_at >= $1::timestamptz-interval '24 hours' AND c.due_at>=s.created_at
 AND NOT EXISTS (SELECT 1 FROM notification_outbox o WHERE o.subscription_id=s.id AND o.event_key=c.event_key)
 `+window+`
 UNION ALL SELECT min(next_attempt_at) FROM notification_outbox WHERE finished_at IS NULL
 ) deadlines`, w.Now()).Scan(&due)
	if due == nil {
		return time.Time{}, err
	}
	return *due, err
}
