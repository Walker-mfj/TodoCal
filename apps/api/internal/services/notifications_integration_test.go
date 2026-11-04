package services_test

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"focuscalendar/internal/database"
	"focuscalendar/internal/dto"
	"focuscalendar/internal/models"
	"focuscalendar/internal/services"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

type recordingPush struct {
	mu      sync.Mutex
	calls   int
	status  int
	payload []byte
}

func (s *recordingPush) Send(ctx context.Context, in models.PushInput, payload []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.payload = payload
	return s.status, nil
}
func TestNotificationDeliveryLifecycle(t *testing.T) {
	url := os.Getenv("NOTIFICATIONS_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("NOTIFICATIONS_TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	pool, e := pgxpool.New(ctx, url)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	if !strings.HasSuffix(pool.Config().ConnConfig.Database, "_test") {
		t.Fatal("test database required")
	}
	if e = database.Migrate(ctx, pool); e != nil {
		t.Fatal(e)
	}
	if _, e = pool.Exec(ctx, "TRUNCATE users, auth_attempts CASCADE"); e != nil {
		t.Fatal(e)
	}
	now := time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	auth := services.Auth{Pool: pool, Now: clock}
	login, e := auth.Register(ctx, services.Credentials{Email: "push@example.com", Password: "correct horse battery", Timezone: "UTC"}, "push-test")
	if e != nil {
		t.Fatal(e)
	}
	p, e := auth.Authenticate(ctx, login.Token)
	if e != nil {
		t.Fatal(e)
	}
	command := func(raw any, op services.Operation) []byte {
		t.Helper()
		b, _ := json.Marshal(raw)
		body, _, err := services.Execute(ctx, pool, clock, p, uuid.NewString(), string(b), dto.Command(b), services.Parameters{}, op)
		if err != nil {
			t.Fatal(err)
		}
		return body
	}
	command(map[string]any{"expectedRevision": 1, "taskStart": true, "deadline": true, "focusComplete": true, "breakComplete": true, "leadMinutes": 5, "quietStart": "", "quietEnd": ""}, services.EditNotificationPreferencesCommand)
	key, _ := ecdh.P256().GenerateKey(rand.Reader)
	in := models.PushInput{Endpoint: "https://fcm.googleapis.com/fcm/send/device-one"}
	in.Keys.P256dh = base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes())
	in.Keys.Auth = base64.RawURLEncoding.EncodeToString(make([]byte, 16))
	command(in, services.SubscribePushCommand)
	in.Endpoint = "https://web.push.apple.com/device-two"
	command(in, services.SubscribePushCommand)
	task := uuid.NewString()
	_, e = pool.Exec(ctx, `INSERT INTO tasks(user_id,id,title,scheduled_date,start_time,end_time,created_at,updated_at) VALUES($1,$2,'PRIVATE TITLE','2026-11-01','10:05','10:30',$3,$3)`, p.ID, task, now)
	if e != nil {
		t.Fatal(e)
	}
	sender := &recordingPush{status: 201}
	worker := services.NotificationWorker{Pool: pool, Now: clock, Sender: sender}
	run := func() {
		t.Helper()
		if _, err := worker.Run(ctx, 100); err != nil {
			t.Fatal(err)
		}
	}
	// Enrollment outlives both credentials, including browsers idle >30 days.
	if _, e = pool.Exec(ctx, "UPDATE auth_sessions SET expires_at=$1,refresh_expires_at=$1 WHERE id=$2", now.Add(-31*24*time.Hour), p.SessionID); e != nil {
		t.Fatal(e)
	}
	run()
	if _, e = pool.Exec(ctx, "UPDATE auth_sessions SET expires_at=$1 WHERE id=$2", now.Add(24*time.Hour), p.SessionID); e != nil {
		t.Fatal(e)
	}
	if sender.calls != 2 {
		t.Fatalf("two devices: %d", sender.calls)
	}
	if strings.Contains(string(sender.payload), "PRIVATE") {
		t.Fatal("private payload")
	}
	run()
	if sender.calls != 2 {
		t.Fatal("duplicate push")
	}
	now = now.Add(5 * time.Minute)
	sender.status = 503
	run()
	if sender.calls != 4 {
		t.Fatalf("start attempts: %d", sender.calls)
	}
	// An already queued transient failure must also retry after credential expiry.
	now = now.Add(time.Minute)
	run()
	if sender.calls != 6 {
		t.Fatal("queued push stopped after refresh expiry")
	}
	_, e = pool.Exec(ctx, "UPDATE tasks SET start_time='12:00',end_time='12:30' WHERE id=$1", task)
	if e != nil {
		t.Fatal(e)
	}
	now = now.Add(2 * time.Minute)
	run()
	if sender.calls != 6 {
		t.Fatal("stale schedule retried")
	}
	// A deleted task must cancel already-queued transient failures.
	deleted := uuid.NewString()
	_, e = pool.Exec(ctx, `INSERT INTO tasks(user_id,id,title,deadline,created_at,updated_at) VALUES($1,$2,'PRIVATE DEADLINE',$3,$4,$4)`, p.ID, deleted, now.Add(5*time.Minute), now)
	if e != nil {
		t.Fatal(e)
	}
	run()
	if sender.calls != 8 {
		t.Fatalf("deadline attempts: %d", sender.calls)
	}
	_, e = pool.Exec(ctx, "UPDATE tasks SET deleted_at=$2 WHERE id=$1", deleted, now)
	if e != nil {
		t.Fatal(e)
	}
	now = now.Add(2 * time.Minute)
	run()
	if sender.calls != 8 {
		t.Fatal("deleted task retried")
	}
	// Quiet hours suppress completion notifications permanently; toggles are rechecked.
	command(map[string]any{"expectedRevision": 2, "taskStart": true, "deadline": true, "focusComplete": true, "breakComplete": true, "leadMinutes": 5, "quietStart": "10:00", "quietEnd": "11:00"}, services.EditNotificationPreferencesCommand)
	_, e = pool.Exec(ctx, `INSERT INTO focus_sessions(user_id,id,kind,status,target_seconds,accumulated_us,started_at,ended_at,pomodoros) VALUES($1,$2,'focus','completed',60,60000000,$3,$4,1)`, p.ID, uuid.NewString(), now.Add(-time.Minute), now)
	if e != nil {
		t.Fatal(e)
	}
	sender.status = 201
	run()
	if sender.calls != 8 {
		t.Fatal("quiet hours ignored")
	}
	command(map[string]any{"expectedRevision": 3, "taskStart": true, "deadline": true, "focusComplete": true, "breakComplete": true, "leadMinutes": 5, "quietStart": "", "quietEnd": ""}, services.EditNotificationPreferencesCommand)
	run()
	if sender.calls != 8 {
		t.Fatal("quiet backlog delivered")
	}
	now = now.Add(time.Minute)
	_, e = pool.Exec(ctx, `INSERT INTO focus_sessions(user_id,id,kind,status,target_seconds,accumulated_us,started_at,ended_at,pomodoros) VALUES($1,$2,'short_break','completed',60,60000000,$3,$4,0)`, p.ID, uuid.NewString(), now.Add(-time.Minute), now)
	if e != nil {
		t.Fatal(e)
	}
	run()
	if sender.calls != 10 {
		t.Fatalf("break completions: %d", sender.calls)
	}
	// Simultaneous workers claim each event/device once.
	now = now.Add(time.Minute)
	_, e = pool.Exec(ctx, `INSERT INTO focus_sessions(user_id,id,kind,status,target_seconds,accumulated_us,started_at,ended_at,pomodoros) VALUES($1,$2,'short_break','completed',60,60000000,$3,$4,0)`, p.ID, uuid.NewString(), now.Add(-time.Minute), now)
	if e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := worker.Run(ctx, 100); errs <- err }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if sender.calls != 12 {
		t.Fatalf("parallel delivery calls: %d", sender.calls)
	}
	// Delayed worker runs must not release events that were due during quiet hours.
	command(map[string]any{"expectedRevision": 4, "taskStart": true, "deadline": true, "focusComplete": true, "breakComplete": true, "leadMinutes": 5, "quietStart": "10:00", "quietEnd": "11:00"}, services.EditNotificationPreferencesCommand)
	now = time.Date(2026, 11, 1, 11, 1, 0, 0, time.UTC)
	_, e = pool.Exec(ctx, `INSERT INTO focus_sessions(user_id,id,kind,status,target_seconds,accumulated_us,started_at,ended_at,pomodoros) VALUES($1,$2,'focus','completed',60,60000000,$3,$4,1)`, p.ID, uuid.NewString(), now.Add(-3*time.Minute), now.Add(-2*time.Minute))
	if e != nil {
		t.Fatal(e)
	}
	run()
	if sender.calls != 12 {
		t.Fatal("delayed quiet event sent")
	}
	// Nonexistent local time produces no candidates; fall-back has one stable instant.
	_, e = pool.Exec(ctx, "UPDATE settings SET timezone='America/New_York' WHERE user_id=$1", p.ID)
	if e != nil {
		t.Fatal(e)
	}
	dst := uuid.NewString()
	_, e = pool.Exec(ctx, `INSERT INTO tasks(user_id,id,title,scheduled_date,start_time,end_time,created_at,updated_at) VALUES($1,$2,'DST','2027-03-14','02:30','03:30',$3,$3)`, p.ID, dst, now)
	if e != nil {
		t.Fatal(e)
	}
	var candidates int
	e = pool.QueryRow(ctx, "SELECT count(*) FROM notification_candidates WHERE event_key LIKE '%'||$1::text||'%'", dst).Scan(&candidates)
	if e != nil || candidates != 0 {
		t.Fatalf("DST gap: %d %v", candidates, e)
	}
	_, e = pool.Exec(ctx, "UPDATE tasks SET scheduled_date='2026-11-01',start_time='01:30',end_time='02:30' WHERE id=$1", dst)
	if e != nil {
		t.Fatal(e)
	}
	var due time.Time
	e = pool.QueryRow(ctx, "SELECT due_at FROM notification_candidates WHERE event_key LIKE 'start:'||$1::text||':%'", dst).Scan(&due)
	if e != nil || !due.Equal(time.Date(2026, 11, 1, 5, 30, 0, 0, time.UTC)) {
		t.Fatalf("DST overlap: %v %v", due, e)
	}
	_, e = pool.Exec(ctx, "UPDATE settings SET timezone='UTC' WHERE user_id=$1", p.ID)
	if e != nil {
		t.Fatal(e)
	}
	if e = auth.Logout(ctx, p); e != nil {
		t.Fatal(e)
	}
	now = time.Date(2026, 11, 1, 11, 55, 0, 0, time.UTC)
	run()
	if sender.calls != 12 {
		t.Fatal("revoked session sent")
	}
	// An explicit new login/opt-in may take over the browser endpoint, and 410
	// removes it from the device list. No old outbox delivery follows the endpoint.
	login, e = auth.Login(ctx, services.Credentials{Email: "push@example.com", Password: "correct horse battery"}, "push-test")
	if e != nil {
		t.Fatal(e)
	}
	p, e = auth.Authenticate(ctx, login.Token)
	if e != nil {
		t.Fatal(e)
	}
	in.Endpoint = "https://fcm.googleapis.com/fcm/send/device-one"
	raw, _ := json.Marshal(in)
	receiptKey := uuid.NewString()
	first, _, e := services.Execute(ctx, pool, clock, p, receiptKey, string(raw), dto.Command(raw), services.Parameters{}, services.SubscribePushCommand)
	if e != nil {
		t.Fatal(e)
	}
	second, _, e := services.Execute(ctx, pool, clock, p, receiptKey, string(raw), dto.Command(raw), services.Parameters{}, services.SubscribePushCommand)
	if e != nil || string(first) != string(second) {
		t.Fatal("subscription receipt replay", e)
	}
	_, _, e = services.Execute(ctx, pool, clock, p, receiptKey, "changed", dto.Command(raw), services.Parameters{}, services.SubscribePushCommand)
	if e == nil {
		t.Fatal("idempotency conflict missing")
	}
	stale := map[string]any{"expectedRevision": 1, "leadMinutes": 5}
	staleRaw, _ := json.Marshal(stale)
	_, _, e = services.Execute(ctx, pool, clock, p, uuid.NewString(), string(staleRaw), dto.Command(staleRaw), services.Parameters{}, services.EditNotificationPreferencesCommand)
	if e == nil {
		t.Fatal("stale preference revision accepted")
	}
	sender.status = 410
	run()
	if sender.calls != 13 {
		t.Fatalf("expired push endpoint calls: %d", sender.calls)
	}
	run()
	if sender.calls != 13 {
		t.Fatal("expired endpoint retried")
	}
	var live int
	e = pool.QueryRow(ctx, "SELECT count(*) FROM push_subscriptions WHERE user_id=$1 AND session_id=$2 AND revoked_at IS NULL", p.ID, p.SessionID).Scan(&live)
	if e != nil || live != 0 {
		t.Fatal("410 did not revoke", e)
	}
}
