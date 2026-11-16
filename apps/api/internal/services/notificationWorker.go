package services

import (
	"context"
	"encoding/json"
	"errors"
	"focuscalendar/internal/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

type PushSender interface {
	Send(context.Context, models.PushInput, []byte) (int, error)
}
type NotificationWorker struct {
	Pool   *pgxpool.Pool
	Now    func() time.Time
	Sender PushSender
	// The embedded scheduler enables bounded lateness for background delivery.
	EnforceLateness bool
}

// Run queues only currently valid schedules and revalidates immediately before each
// attempt. A quiet-hour event is suppressed, not delivered as an unexpected backlog.
// Delivery is at-least-once across a crash after provider acceptance; payload tags
// give service workers a stable browser notification replacement identity.
func (w NotificationWorker) Run(ctx context.Context, limit int) (int, error) {
	if w.Sender == nil {
		return 0, nil
	}
	if limit < 1 || limit > 1000 {
		limit = 100
	}
	now := w.Now()
	window := ""
	if w.EnforceLateness {
		window = notificationCandidateWindow
	}
	_, e := w.Pool.Exec(ctx, `INSERT INTO notification_outbox(id,subscription_id,event_key,due_at,kind,next_attempt_at)
 SELECT gen_random_uuid(),s.id,c.event_key,c.due_at,c.kind,$1 FROM notification_candidates c
 JOIN push_subscriptions s ON s.user_id=c.user_id JOIN auth_sessions a ON a.id=s.session_id
 JOIN notification_preferences p ON p.user_id=c.user_id
 WHERE s.revoked_at IS NULL AND a.revoked_at IS NULL
 AND c.due_at>=$1::timestamptz-interval '24 hours' AND c.due_at<=$1 AND c.due_at>=s.created_at
 AND NOT EXISTS(SELECT 1 FROM notification_outbox o WHERE o.subscription_id=s.id AND o.event_key=c.event_key)
 `+window+` ORDER BY c.due_at,s.id LIMIT $2 ON CONFLICT DO NOTHING`, now, limit)
	if e != nil {
		return 0, e
	}
	count := 0
	for i := 0; i < limit; i++ {
		sent, found, err := w.deliver(ctx, w.Now())
		if err != nil {
			return count, err
		}
		if !found {
			break
		}
		if sent {
			count++
		}
	}
	return count, nil
}
func (w NotificationWorker) deliver(ctx context.Context, now time.Time) (bool, bool, error) {
	tx, e := w.Pool.Begin(ctx)
	if e != nil {
		return false, false, e
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var id, subID, kind, eventKey, zone string
	var input models.PushInput
	var due time.Time
	var attempts int
	var leadMinutes int
	var valid bool
	var quiet NotificationPreferences
	e = tx.QueryRow(ctx, `SELECT o.id,s.id,o.kind,o.event_key,o.due_at,o.attempts,s.endpoint,s.p256dh,s.auth,st.timezone,
 COALESCE(p.quiet_start,''),COALESCE(p.quiet_end,''),COALESCE(p.lead_minutes,0),
 s.revoked_at IS NULL AND a.revoked_at IS NULL AND o.due_at>=$1::timestamptz-interval '24 hours'
 AND EXISTS(SELECT 1 FROM notification_candidates c WHERE c.user_id=s.user_id AND c.event_key=o.event_key AND c.due_at=o.due_at)
 FROM notification_outbox o JOIN push_subscriptions s ON s.id=o.subscription_id JOIN auth_sessions a ON a.id=s.session_id
 JOIN settings st ON st.user_id=s.user_id LEFT JOIN notification_preferences p ON p.user_id=s.user_id
 WHERE o.finished_at IS NULL AND o.next_attempt_at<=$1 ORDER BY o.next_attempt_at,o.id
 LIMIT 1 FOR UPDATE OF o,s,a SKIP LOCKED`, now).Scan(&id, &subID, &kind, &eventKey, &due, &attempts, &input.Endpoint, &input.Keys.P256dh, &input.Keys.Auth, &zone, &quiet.QuietStart, &quiet.QuietEnd, &leadMinutes, &valid)
	if errors.Is(e, pgx.ErrNoRows) {
		return false, false, nil
	}
	if e != nil {
		return false, false, e
	}
	finish := func(outcome string) (bool, bool, error) {
		_, err := tx.Exec(ctx, "UPDATE notification_outbox SET finished_at=$2,outcome=$3 WHERE id=$1", id, now, outcome)
		if err == nil {
			err = tx.Commit(ctx)
		}
		return outcome == "sent", true, err
	}
	// Refresh after acquiring locks: a slow DB must not use the batch's old clock
	// to start a send beyond its cutoff or during newly entered quiet hours.
	now = w.Now()
	if !valid || (w.EnforceLateness && !notificationCanSend(kind, due, leadMinutes, now)) {
		return finish("canceled")
	}
	if quiet.IsQuiet(now, zone) || quiet.IsQuiet(due, zone) {
		return finish("quiet_hours")
	}
	body := "You have a TodoCal reminder."
	switch kind {
	case "task_start":
		body = "Your scheduled time is starting."
	case "task_lead":
		body = "Your scheduled time is approaching."
	case "deadline":
		body = "A task deadline is approaching."
	case "focus_complete":
		body = "Your focus session is complete."
	case "break_complete":
		body = "Your break is complete. Start your next session when ready."
	}
	// No task title, identifiers, account details or auth credentials in the payload.
	destination := "/?notification=calendar"
	if kind == "focus_complete" || kind == "break_complete" {
		destination = "/?notification=focus"
	}
	payload, _ := json.Marshal(map[string]string{"title": "TodoCal", "body": body, "url": destination, "tag": "todocal-" + uuid.NewSHA1(uuid.NameSpaceOID, []byte(eventKey)).String()})
	attemptCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	status, sendErr := w.Sender.Send(attemptCtx, input, payload)
	cancel()
	if sendErr == nil && status >= 200 && status < 300 {
		return finish("sent")
	}
	if status == 404 || status == 410 {
		if _, e = tx.Exec(ctx, "UPDATE push_subscriptions SET revoked_at=$2 WHERE id=$1", subID, now); e != nil {
			return false, true, e
		}
		return finish("expired")
	}
	attempts++
	if attempts >= 6 || (sendErr == nil && status >= 400 && status < 500 && status != 408 && status != 429) {
		return finish("failed")
	}
	delay := time.Minute * time.Duration(1<<uint(attempts-1))
	next := w.Now().Add(delay)
	if w.EnforceLateness && !notificationCanSend(kind, due, leadMinutes, next) {
		return finish("canceled")
	}
	_, e = tx.Exec(ctx, "UPDATE notification_outbox SET attempts=$2,next_attempt_at=$3,outcome='retry' WHERE id=$1", id, attempts, next)
	if e == nil {
		e = tx.Commit(ctx)
	}
	return false, true, e
}
