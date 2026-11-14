DROP INDEX tasks_notification_deadline;
DROP INDEX focus_completed_notification;
DROP INDEX focus_due_time;
DROP TRIGGER schedule_sessions_dirty ON auth_sessions;
DROP TRIGGER schedule_subscriptions_dirty ON push_subscriptions;
DROP TRIGGER schedule_focus_dirty ON focus_sessions;
DROP TRIGGER schedule_tasks_dirty ON tasks;
DROP FUNCTION mark_notification_schedule_dirty();
CREATE OR REPLACE FUNCTION invalidate_notification_horizon() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO notification_horizons(user_id,next_run_at) VALUES(NEW.user_id,CURRENT_TIMESTAMP)
 ON CONFLICT(user_id) DO UPDATE SET next_run_at=LEAST(notification_horizons.next_run_at,EXCLUDED.next_run_at);
 RETURN NEW;
END;
$$;
DROP FUNCTION notification_horizon_needed(uuid,timestamptz);
ALTER TABLE notification_horizons DROP COLUMN after_series, DROP COLUMN cycle_at;
UPDATE notification_horizons SET next_run_at=CURRENT_TIMESTAMP WHERE next_run_at IS NULL;
ALTER TABLE notification_horizons ALTER COLUMN next_run_at SET NOT NULL;
