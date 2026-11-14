package services

import (
	"context"
	"testing"
	"time"
)

func TestNotificationNextDueWithoutSender(t *testing.T) {
	// A nil pool proves that disabled delivery never queries or arms a deadline.
	due, err := (NotificationWorker{}).NextDue(context.Background())
	if err != nil || !due.IsZero() {
		t.Fatalf("disabled delivery: %v %v", due, err)
	}
}

func TestNotificationSendCutoff(t *testing.T) {
	due := time.Date(2026, 11, 14, 10, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		kind string
		lead int
		want time.Duration
	}{
		{"focus_complete", 5, 5 * time.Minute}, {"break_complete", 5, 5 * time.Minute},
		{"task_lead", 1, time.Minute}, {"task_lead", 10, 5 * time.Minute},
		{"task_start", 5, 10 * time.Minute}, {"deadline", 5, 15 * time.Minute},
	} {
		cutoff := notificationSendCutoff(tc.kind, due, tc.lead)
		if cutoff.Sub(due) != tc.want {
			t.Errorf("%s: %s", tc.kind, cutoff.Sub(due))
		}
		if notificationCanSend(tc.kind, due, tc.lead, cutoff.Add(time.Microsecond)) {
			t.Fatal("send past cutoff")
		}
		wantAt := tc.kind != "task_lead" || tc.lead > 5
		if notificationCanSend(tc.kind, due, tc.lead, cutoff) != wantAt {
			t.Fatalf("boundary %s/%d", tc.kind, tc.lead)
		}
	}
}
