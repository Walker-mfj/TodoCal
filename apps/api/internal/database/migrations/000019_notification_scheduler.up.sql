-- Durable horizon deadlines are invalidated in the same transaction as edits.
-- The process-local wake is an optimization; startup can recover this table.
CREATE TABLE notification_horizons (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 next_run_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX notification_horizons_due ON notification_horizons(next_run_at, user_id);
INSERT INTO notification_horizons(user_id) SELECT id FROM users;

CREATE FUNCTION invalidate_notification_horizon() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO notification_horizons(user_id, next_run_at) VALUES(NEW.user_id, CURRENT_TIMESTAMP)
 ON CONFLICT(user_id) DO UPDATE SET next_run_at = LEAST(notification_horizons.next_run_at, EXCLUDED.next_run_at);
 RETURN NEW;
END;
$$;
CREATE TRIGGER notification_settings_changed AFTER INSERT OR UPDATE ON settings
 FOR EACH ROW EXECUTE FUNCTION invalidate_notification_horizon();
CREATE TRIGGER notification_preferences_changed AFTER INSERT OR UPDATE ON notification_preferences
 FOR EACH ROW EXECUTE FUNCTION invalidate_notification_horizon();
CREATE TRIGGER notification_recurrence_changed AFTER INSERT OR UPDATE ON recurrence_series
 FOR EACH ROW EXECUTE FUNCTION invalidate_notification_horizon();

CREATE TABLE notification_maintenance (
 name text PRIMARY KEY,
 next_run_at timestamptz NOT NULL
);
INSERT INTO notification_maintenance VALUES ('cleanup',CURRENT_TIMESTAMP);
CREATE INDEX notification_finished_retention ON notification_outbox(finished_at,id) WHERE finished_at IS NOT NULL;
CREATE INDEX focus_running_deadlines ON focus_sessions(running_since,user_id) WHERE status='running';
