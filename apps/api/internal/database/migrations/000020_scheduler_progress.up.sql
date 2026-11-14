-- Transaction-local dirty state is rolled back with the mutations that set it.
-- Read-only requests (including planning cursor updates) never set this flag.
CREATE FUNCTION mark_notification_schedule_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 PERFORM set_config('todocal.schedule_dirty', 'on', true);
 RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER schedule_tasks_dirty AFTER INSERT OR UPDATE OR DELETE ON tasks
 FOR EACH ROW EXECUTE FUNCTION mark_notification_schedule_dirty();
CREATE TRIGGER schedule_focus_dirty AFTER INSERT OR UPDATE OR DELETE ON focus_sessions
 FOR EACH ROW EXECUTE FUNCTION mark_notification_schedule_dirty();
CREATE TRIGGER schedule_subscriptions_dirty AFTER INSERT OR UPDATE OR DELETE ON push_subscriptions
 FOR EACH ROW EXECUTE FUNCTION mark_notification_schedule_dirty();
CREATE TRIGGER schedule_sessions_dirty AFTER UPDATE OF revoked_at ON auth_sessions
 FOR EACH ROW WHEN (OLD.revoked_at IS DISTINCT FROM NEW.revoked_at)
 EXECUTE FUNCTION mark_notification_schedule_dirty();

ALTER TABLE notification_horizons ALTER COLUMN next_run_at DROP NOT NULL;
ALTER TABLE notification_horizons ADD COLUMN after_series uuid;
ALTER TABLE notification_horizons ADD COLUMN cycle_at timestamptz;

-- Dormant accounts retain a cheap row but have no deadline. Date checks are
-- conservative: a future series is eligible even before its first occurrence.
CREATE FUNCTION notification_horizon_needed(account uuid, at_time timestamptz) RETURNS boolean
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
CREATE OR REPLACE FUNCTION invalidate_notification_horizon() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN
   IF TG_TABLE_NAME = 'settings' THEN
     IF NEW.timezone IS NOT DISTINCT FROM OLD.timezone THEN RETURN NEW; END IF;
   END IF;
   IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 END IF;
 PERFORM set_config('todocal.schedule_dirty', 'on', true);
 INSERT INTO notification_horizons(user_id,next_run_at) VALUES(NEW.user_id,
   CASE WHEN notification_horizon_needed(NEW.user_id,CURRENT_TIMESTAMP) THEN CURRENT_TIMESTAMP END)
 ON CONFLICT(user_id) DO UPDATE SET next_run_at=EXCLUDED.next_run_at,after_series=NULL,cycle_at=NULL;
 RETURN NEW;
END;
$$;
UPDATE notification_horizons SET next_run_at=NULL
 WHERE NOT notification_horizon_needed(user_id,CURRENT_TIMESTAMP);

-- UTC makes elapsed-second arithmetic immutable and independent of DB timezone.
CREATE INDEX focus_due_time ON focus_sessions (
 (((running_since AT TIME ZONE 'UTC') + (target_seconds::double precision - accumulated_us::double precision/1000000) * interval '1 second') AT TIME ZONE 'UTC')
) WHERE status='running';
CREATE INDEX focus_completed_notification ON focus_sessions(ended_at,user_id) WHERE status='completed' AND ended_at IS NOT NULL;
CREATE INDEX tasks_notification_deadline ON tasks(user_id,deadline) WHERE deleted_at IS NULL AND status='incomplete' AND deadline IS NOT NULL;
