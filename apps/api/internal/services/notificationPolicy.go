package services

import "time"

func notificationSendCutoff(kind string, due time.Time, leadMinutes int) time.Time {
	window := 5 * time.Minute
	switch kind {
	case "task_start":
		window = 10 * time.Minute
	case "deadline":
		window = 15 * time.Minute
	case "task_lead":
		if leadMinutes < 5 {
			window = time.Duration(leadMinutes) * time.Minute
		}
	}
	return due.Add(window)
}

func notificationCanSend(kind string, due time.Time, leadMinutes int, now time.Time) bool {
	if kind == "task_lead" && !now.Before(due.Add(time.Duration(leadMinutes)*time.Minute)) {
		return false
	}
	return !now.After(notificationSendCutoff(kind, due, leadMinutes))
}

// Shared by enqueue and NextDue. Join alias p is notification_preferences.
// Using the same predicate keeps expired candidates from spinning the timer.
const notificationCandidateWindow = ` AND c.due_at >= $1::timestamptz - CASE c.kind
 WHEN 'task_start' THEN interval '10 minutes'
 WHEN 'deadline' THEN interval '15 minutes' ELSE interval '5 minutes' END
 AND (c.kind <> 'task_lead' OR c.due_at + make_interval(mins=>p.lead_minutes) > $1)`
