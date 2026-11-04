package services

import (
	"context"
	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"os"
	"time"
)

func GetNotificationsCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, error) {
	prefs, e := repository.NotificationPreferences(ctx, tx, p.ID)
	if e != nil {
		return nil, e
	}
	devices, e := repository.ListPushDevices(ctx, tx, p.ID, p.SessionID, now)
	key := ""
	if os.Getenv("VAPID_PRIVATE_KEY") != "" && os.Getenv("VAPID_SUBJECT") != "" {
		key = os.Getenv("VAPID_PUBLIC_KEY")
	}
	return map[string]any{"publicKey": key, "preferences": prefs, "subscriptions": devices}, e
}
func EditNotificationPreferencesCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	decoder, ok := input.(interface {
		NotificationPreferences() (models.NotificationPreferencesInput, error)
	})
	if !ok {
		return nil, 0, Invalid("Invalid preferences")
	}
	in, e := decoder.NotificationPreferences()
	if e != nil {
		return nil, 0, e
	}
	if e = NotificationPreferences(in.NotificationPreferences).Validate(); e != nil {
		return nil, 0, e
	}
	current, e := repository.NotificationPreferences(ctx, tx, p.ID)
	if e != nil {
		return nil, 0, e
	}
	if in.ExpectedRevision != current.Revision {
		return nil, 0, Conflict()
	}
	in.Revision = current.Revision + 1
	e = repository.SaveNotificationPreferences(ctx, tx, p.ID, in.NotificationPreferences)
	return in.NotificationPreferences, models.Updated, e
}
func SubscribePushCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	decoder, ok := input.(interface {
		PushSubscription() (models.PushInput, error)
	})
	if !ok {
		return nil, 0, Invalid("Invalid subscription")
	}
	in, e := decoder.PushSubscription()
	if e != nil {
		return nil, 0, e
	}
	if e = PushInput(in).Validate(); e != nil {
		return nil, 0, e
	}
	// Different accounts can explicitly re-enroll the same browser concurrently.
	// Serialize endpoint reassignment before deleting its old outbox/ownership.
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", in.Endpoint); e != nil {
		return nil, 0, e
	}
	var count int
	e = tx.QueryRow(ctx, "SELECT count(*) FROM push_subscriptions s JOIN auth_sessions a ON a.id=s.session_id WHERE s.user_id=$1 AND s.revoked_at IS NULL AND a.revoked_at IS NULL AND s.endpoint<>$2", p.ID, in.Endpoint).Scan(&count)
	if e != nil {
		return nil, 0, e
	}
	if count >= 20 {
		return nil, 0, Invalid("Revoke an existing device before adding another")
	}
	if in.DeviceName == "" {
		in.DeviceName = "Unknown browser"
	}
	id := uuid.NewString()
	// A browser endpoint can move to its new account/session only through an explicit
	// subscription command. Fresh consent resets its creation time and cancels old work.
	_, e = tx.Exec(ctx, "DELETE FROM push_subscriptions WHERE endpoint=$1", in.Endpoint)
	if e != nil {
		return nil, 0, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO push_subscriptions(id,user_id,session_id,endpoint,p256dh,auth,created_at,device_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id, p.ID, p.SessionID, in.Endpoint, in.Keys.P256dh, in.Keys.Auth, now, in.DeviceName)
	return map[string]string{"id": id}, models.Created, e
}
func RevokePushCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	if _, e := uuid.Parse(params.ID); e != nil {
		return nil, 0, Invalid("Invalid device")
	}
	if e := input.Empty(); e != nil {
		return nil, 0, e
	}
	result, e := tx.Exec(ctx, "UPDATE push_subscriptions SET revoked_at=$3 WHERE id=$1 AND user_id=$2", params.ID, p.ID, now)
	if e != nil {
		return nil, 0, e
	}
	if result.RowsAffected() == 0 {
		return nil, 0, &Fault{Code: "not_found", Message: "Device not found"}
	}
	return map[string]bool{"ok": true}, models.Updated, nil
}
