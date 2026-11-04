package repository

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"focuscalendar/internal/models"
	"github.com/jackc/pgx/v5"
	"time"
)

func NotificationPreferences(ctx context.Context, tx pgx.Tx, user string) (models.NotificationPreferences, error) {
	p := models.NotificationPreferences{LeadMinutes: 5, Revision: 1}
	_, e := tx.Exec(ctx, "INSERT INTO notification_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING", user)
	if e != nil {
		return p, e
	}
	e = tx.QueryRow(ctx, `SELECT task_start,deadline,focus_complete,break_complete,lead_minutes,quiet_start,quiet_end,revision FROM notification_preferences WHERE user_id=$1`, user).Scan(&p.TaskStart, &p.Deadline, &p.FocusComplete, &p.BreakComplete, &p.LeadMinutes, &p.QuietStart, &p.QuietEnd, &p.Revision)
	return p, e
}
func SaveNotificationPreferences(ctx context.Context, tx pgx.Tx, user string, p models.NotificationPreferences) error {
	_, e := tx.Exec(ctx, `UPDATE notification_preferences SET task_start=$2,deadline=$3,focus_complete=$4,break_complete=$5,lead_minutes=$6,quiet_start=$7,quiet_end=$8,revision=revision+1 WHERE user_id=$1`, user, p.TaskStart, p.Deadline, p.FocusComplete, p.BreakComplete, p.LeadMinutes, p.QuietStart, p.QuietEnd)
	return e
}

type PushDevice struct {
	DeviceName    string    `json:"deviceName"`
	EndpointHash  string    `json:"endpointHash"`
	ID            string    `json:"id"`
	CreatedAt     time.Time `json:"createdAt"`
	CurrentDevice bool      `json:"currentDevice"`
}

func ListPushDevices(ctx context.Context, tx pgx.Tx, user, session string, now time.Time) ([]PushDevice, error) {
	rows, e := tx.Query(ctx, `SELECT p.id,p.created_at,p.session_id=$2::uuid,p.device_name,p.endpoint FROM push_subscriptions p JOIN auth_sessions a ON a.id=p.session_id WHERE p.user_id=$1 AND p.revoked_at IS NULL AND a.revoked_at IS NULL ORDER BY p.created_at,p.id`, user, session)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []PushDevice{}
	for rows.Next() {
		var d PushDevice
		var endpoint string
		if e = rows.Scan(&d.ID, &d.CreatedAt, &d.CurrentDevice, &d.DeviceName, &endpoint); e != nil {
			return nil, e
		}
		hash := sha256.Sum256([]byte(endpoint))
		d.EndpointHash = hex.EncodeToString(hash[:])
		out = append(out, d)
	}
	return out, rows.Err()
}
