-- Old schema cannot represent overnight intervals; refuse a lossy rollback.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM tasks WHERE scheduled_end_date<>scheduled_date OR end_time<=start_time) THEN
   RAISE EXCEPTION 'Cannot rollback task instants while overnight tasks exist';
 END IF;
END $$;
DROP VIEW notification_candidates;
DROP TRIGGER tasks_initialize_instants ON tasks;
DROP FUNCTION initialize_task_instants();
DROP TRIGGER series_initialize_timezone ON recurrence_series;
DROP FUNCTION initialize_series_timezone();
DROP FUNCTION task_local_date(tasks);
DROP TRIGGER schedule_tasks_updated ON tasks;
ALTER TABLE tasks DROP CONSTRAINT tasks_interval;
ALTER TABLE tasks DROP COLUMN scheduled_end_date, DROP COLUMN scheduled_start_at, DROP COLUMN scheduled_end_at;
ALTER TABLE tasks ADD CHECK((start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL AND scheduled_date IS NOT NULL AND end_time>start_time));
CREATE OR REPLACE FUNCTION notification_horizon_needed(account uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
 SELECT 1 FROM recurrence_series r
 JOIN notification_preferences p ON p.user_id=r.user_id
 JOIN settings s ON s.user_id=r.user_id
 WHERE r.user_id=account
 AND ((p.task_start AND r.template->>'startTime' IS NOT NULL)
      OR (p.deadline AND r.deadline_offset IS NOT NULL))
 AND (r.end_date IS NULL OR r.end_date+r.schedule_offset_days >= (at_time AT TIME ZONE s.timezone)::date)
 AND (r.stopped_after IS NULL OR r.stopped_after >= (at_time AT TIME ZONE s.timezone)::date)
 AND (r.original_cutoff IS NULL OR r.original_cutoff+r.schedule_offset_days > (at_time AT TIME ZONE s.timezone)::date)
 )
$$;

ALTER TABLE recurrence_series DROP COLUMN timezone;
ALTER TABLE schedule_undos DROP COLUMN previous_end_date,DROP COLUMN previous_start_at,DROP COLUMN previous_end_at;
DROP FUNCTION schedule_instant(timestamp,text);
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

CREATE TRIGGER schedule_tasks_updated AFTER UPDATE ON tasks
 FOR EACH ROW WHEN (
 ROW(OLD.user_id,OLD.id,OLD.scheduled_date,OLD.start_time,OLD.deadline,OLD.status,OLD.deleted_at)
 IS DISTINCT FROM
 ROW(NEW.user_id,NEW.id,NEW.scheduled_date,NEW.start_time,NEW.deadline,NEW.status,NEW.deleted_at)
 ) EXECUTE FUNCTION mark_notification_schedule_dirty();
