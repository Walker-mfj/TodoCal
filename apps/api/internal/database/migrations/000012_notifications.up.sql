CREATE TABLE notification_preferences (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 task_start boolean NOT NULL DEFAULT false, deadline boolean NOT NULL DEFAULT false,
 focus_complete boolean NOT NULL DEFAULT false, break_complete boolean NOT NULL DEFAULT false,
 lead_minutes integer NOT NULL DEFAULT 5 CHECK(lead_minutes BETWEEN 0 AND 1440),
 quiet_start text NOT NULL DEFAULT '', quiet_end text NOT NULL DEFAULT '',
 revision bigint NOT NULL DEFAULT 1
);
CREATE TABLE push_subscriptions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
 endpoint text NOT NULL UNIQUE, p256dh text NOT NULL, auth text NOT NULL,
 created_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE INDEX push_subscription_users ON push_subscriptions(user_id) WHERE revoked_at IS NULL;
CREATE TABLE notification_outbox (
 id uuid PRIMARY KEY, subscription_id uuid NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
 event_key text NOT NULL, due_at timestamptz NOT NULL, kind text NOT NULL,
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL,
 finished_at timestamptz, outcome text,
 UNIQUE(subscription_id,event_key)
);
CREATE INDEX notification_pending ON notification_outbox(next_attempt_at) WHERE finished_at IS NULL;
-- Derive event identities from the actual schedule, never from an unrelated task revision.
-- Round-trip rejects nonexistent wall times. When a clock repeats, select the
-- earlier valid instant, matching localdate.Instant used by recurrence deadlines.
CREATE VIEW notification_candidates AS
WITH wall_times AS (
 SELECT t.user_id,t.id,t.scheduled_date+t.start_time AS wall,s.timezone,p.lead_minutes
 FROM tasks t JOIN settings s ON s.user_id=t.user_id JOIN notification_preferences p ON p.user_id=t.user_id
 WHERE p.task_start AND t.deleted_at IS NULL AND t.status='incomplete' AND t.start_time IS NOT NULL
), resolved AS (
 SELECT *,wall AT TIME ZONE timezone AS fallback,
 ((wall-interval '1 day') AT TIME ZONE timezone)+interval '24 hours' AS prior
 FROM wall_times
), scheduled AS (
 SELECT user_id,id,lead_minutes,
 LEAST(fallback,CASE WHEN prior AT TIME ZONE timezone=wall THEN prior ELSE fallback END) AS target
 FROM resolved WHERE fallback AT TIME ZONE timezone=wall
), events AS (
 SELECT user_id,'start:'||id::text||':'||extract(epoch FROM target)::text AS event_key,target AS due_at,'task_start'::text AS kind FROM scheduled
 UNION ALL SELECT user_id,'lead:'||id::text||':'||extract(epoch FROM target)::text||':'||lead_minutes::text,target-make_interval(mins=>lead_minutes),'task_lead' FROM scheduled WHERE lead_minutes>0
 UNION ALL SELECT t.user_id,'deadline:'||t.id::text||':'||extract(epoch FROM t.deadline)::text||':'||p.lead_minutes::text,t.deadline-make_interval(mins=>p.lead_minutes),'deadline'
 FROM tasks t JOIN notification_preferences p ON p.user_id=t.user_id WHERE p.deadline AND t.deadline IS NOT NULL AND t.deleted_at IS NULL AND t.status='incomplete'
 UNION ALL SELECT f.user_id,'complete:'||f.id::text,f.ended_at,CASE WHEN f.kind='focus' THEN 'focus_complete' ELSE 'break_complete' END
 FROM focus_sessions f JOIN notification_preferences p ON p.user_id=f.user_id
 WHERE f.status='completed' AND f.ended_at IS NOT NULL AND ((f.kind='focus' AND p.focus_complete) OR (f.kind<>'focus' AND p.break_complete))
)
SELECT * FROM events;
