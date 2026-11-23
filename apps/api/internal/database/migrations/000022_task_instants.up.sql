-- Canonical timed intervals never change when the account display zone changes.
ALTER TABLE tasks ADD COLUMN scheduled_end_date date,
 ADD COLUMN scheduled_start_at timestamptz, ADD COLUMN scheduled_end_at timestamptz;
ALTER TABLE recurrence_series ADD COLUMN timezone text;
UPDATE recurrence_series r SET timezone=s.timezone FROM settings s WHERE s.user_id=r.user_id;
ALTER TABLE recurrence_series ALTER COLUMN timezone SET NOT NULL;

-- Same gap/overlap convention as localdate.Instant: reject a gap and choose
-- the earlier occurrence of an ambiguous clock during legacy backfill.
CREATE FUNCTION schedule_instant(wall timestamp, zone text) RETURNS timestamptz
 LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT min(candidate) FROM (
   SELECT (wall AT TIME ZONE zone) AS candidate
   UNION ALL SELECT ((wall-interval '1 day') AT TIME ZONE zone)+interval '24 hours'
   UNION ALL SELECT ((wall+interval '1 day') AT TIME ZONE zone)-interval '24 hours'
 ) x WHERE candidate AT TIME ZONE zone=wall
$$;
-- Old releases allowed changing the account zone into a DST gap. Prefer the
-- latest recorded zone for this exact schedule when the current zone cannot
-- represent both endpoints. If no provenance exists, normalize the start with
-- PostgreSQL's gap rule and preserve the previously positive wall duration.
WITH legacy AS (
 SELECT t.user_id,t.id,t.scheduled_date+t.start_time AS wall_start,t.scheduled_date+t.end_time AS wall_end,COALESCE((SELECT ds.timezone FROM daily_plan_entries p JOIN daily_snapshots ds ON ds.user_id=p.user_id AND ds.date=p.date
 WHERE p.user_id=t.user_id AND p.task_id=t.id
 AND p.task_state->'task'->>'scheduledDate'=t.scheduled_date::text
 AND p.task_state->'task'->>'startTime'=to_char(t.start_time,'HH24:MI')
 AND p.task_state->'task'->>'endTime'=to_char(t.end_time,'HH24:MI')
 ORDER BY p.date DESC LIMIT 1),s.timezone) AS timezone,
 (SELECT e.timezone FROM task_events e WHERE e.user_id=t.user_id AND e.task_id=t.id
  AND e.after_state->>'scheduledDate'=t.scheduled_date::text
  AND e.after_state->>'startTime'=to_char(t.start_time,'HH24:MI')
  AND e.after_state->>'endTime'=to_char(t.end_time,'HH24:MI')
  ORDER BY e.occurred_at DESC,(e.after_state->>'revision')::bigint DESC LIMIT 1) AS recorded_zone
 FROM tasks t JOIN settings s ON s.user_id=t.user_id WHERE t.start_time IS NOT NULL
), resolved AS (
 SELECT *,CASE WHEN schedule_instant(wall_start,timezone) IS NOT NULL AND schedule_instant(wall_end,timezone) IS NOT NULL
 THEN timezone ELSE COALESCE(recorded_zone,timezone) END AS resolve_zone FROM legacy
), endpoints AS (
 SELECT *,COALESCE(schedule_instant(wall_start,resolve_zone),wall_start AT TIME ZONE resolve_zone) AS a,
 schedule_instant(wall_end,resolve_zone) AS b FROM resolved
)
UPDATE tasks t SET scheduled_end_date=t.scheduled_date,scheduled_start_at=e.a,
 scheduled_end_at=CASE WHEN e.b>e.a THEN e.b ELSE e.a+(e.wall_end-e.wall_start) END
 FROM endpoints e WHERE e.user_id=t.user_id AND e.id=t.id;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='tasks'::regclass AND contype='c'
   AND pg_get_constraintdef(oid) LIKE '%end_time > start_time%'
 LOOP EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE tasks ADD CONSTRAINT tasks_interval CHECK (
 (start_time IS NULL AND end_time IS NULL AND scheduled_end_date IS NULL AND scheduled_start_at IS NULL AND scheduled_end_at IS NULL)
 OR (scheduled_date IS NOT NULL AND scheduled_end_date IS NOT NULL AND start_time IS NOT NULL AND end_time IS NOT NULL
     AND scheduled_start_at IS NOT NULL AND scheduled_end_at IS NOT NULL AND scheduled_end_at>scheduled_start_at));
CREATE INDEX tasks_start_instant ON tasks(user_id,scheduled_start_at) WHERE deleted_at IS NULL;
CREATE INDEX tasks_end_instant ON tasks(user_id,scheduled_end_at) WHERE deleted_at IS NULL;
CREATE FUNCTION task_local_date(t tasks) RETURNS date LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN t.scheduled_start_at IS NULL THEN t.scheduled_date
 ELSE (t.scheduled_start_at AT TIME ZONE s.timezone)::date END FROM settings s WHERE s.user_id=t.user_id
$$;

-- Legacy SQL writers (including operational scripts) may still insert clocks.
-- Application writes always supply the canonical endpoints explicitly.
CREATE FUNCTION initialize_task_instants() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE zone text;
BEGIN
 IF NEW.start_time IS NOT NULL AND NEW.scheduled_start_at IS NULL THEN
   SELECT timezone INTO zone FROM settings WHERE user_id=NEW.user_id;
   NEW.scheduled_end_date := COALESCE(NEW.scheduled_end_date,NEW.scheduled_date);
   NEW.scheduled_start_at := schedule_instant(NEW.scheduled_date+NEW.start_time,zone);
   NEW.scheduled_end_at := schedule_instant(NEW.scheduled_end_date+NEW.end_time,zone);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tasks_initialize_instants BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION initialize_task_instants();
CREATE FUNCTION initialize_series_timezone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.timezone IS NULL THEN SELECT timezone INTO NEW.timezone FROM settings WHERE user_id=NEW.user_id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER series_initialize_timezone BEFORE INSERT ON recurrence_series FOR EACH ROW EXECUTE FUNCTION initialize_series_timezone();

-- Historical JSON uses its recorded zone, not today's account zone.
CREATE FUNCTION backfill_task_instants(state jsonb, zone text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN state->>'startTime' IS NULL THEN state ELSE state || jsonb_build_object(
 'scheduledEndDate',state->>'scheduledDate',
 'scheduledStartAt',schedule_instant((state->>'scheduledDate')::date+(state->>'startTime')::time,zone),
 'scheduledEndAt',schedule_instant((state->>'scheduledDate')::date+(state->>'endTime')::time,zone)) END
$$;
UPDATE task_events SET before_state=backfill_task_instants(before_state,timezone),after_state=backfill_task_instants(after_state,timezone);
UPDATE daily_plan_entries e SET task_state=jsonb_set(e.task_state,'{task}',backfill_task_instants(e.task_state->'task',s.timezone))
 FROM daily_snapshots s WHERE s.user_id=e.user_id AND s.date=e.date;
DROP FUNCTION backfill_task_instants(jsonb,text);
ALTER TABLE schedule_undos ADD COLUMN previous_end_date date, ADD COLUMN previous_start_at timestamptz, ADD COLUMN previous_end_at timestamptz;
UPDATE schedule_undos u SET previous_end_date=CASE WHEN u.previous_start IS NOT NULL THEN u.previous_date END,
 previous_start_at=schedule_instant(u.previous_date+u.previous_start,s.timezone),
 previous_end_at=schedule_instant(u.previous_date+u.previous_end,s.timezone)
 FROM settings s WHERE s.user_id=u.user_id;

CREATE OR REPLACE VIEW notification_candidates AS
WITH scheduled AS (
 SELECT t.user_id,t.id,p.lead_minutes,t.scheduled_start_at AS target
 FROM tasks t JOIN notification_preferences p ON p.user_id=t.user_id
 WHERE p.task_start AND t.deleted_at IS NULL AND t.status='incomplete' AND t.scheduled_start_at IS NOT NULL
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

CREATE OR REPLACE FUNCTION notification_horizon_needed(account uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
 SELECT 1 FROM recurrence_series r
 JOIN notification_preferences p ON p.user_id=r.user_id
 JOIN settings s ON s.user_id=r.user_id
 WHERE r.user_id=account
 AND ((p.task_start AND r.template->>'startTime' IS NOT NULL)
      OR (p.deadline AND r.deadline_offset IS NOT NULL))
 AND (r.end_date IS NULL OR r.end_date+r.schedule_offset_days >= (at_time AT TIME ZONE r.timezone)::date)
 AND (r.stopped_after IS NULL OR r.stopped_after >= (at_time AT TIME ZONE r.timezone)::date)
 AND (r.original_cutoff IS NULL OR r.original_cutoff+r.schedule_offset_days > (at_time AT TIME ZONE r.timezone)::date)
 )
$$;
DROP TRIGGER schedule_tasks_updated ON tasks;
CREATE TRIGGER schedule_tasks_updated AFTER UPDATE ON tasks
 FOR EACH ROW WHEN (
 ROW(OLD.user_id,OLD.id,OLD.scheduled_start_at,OLD.deadline,OLD.status,OLD.deleted_at)
 IS DISTINCT FROM ROW(NEW.user_id,NEW.id,NEW.scheduled_start_at,NEW.deadline,NEW.status,NEW.deleted_at)
 ) EXECUTE FUNCTION mark_notification_schedule_dirty();
