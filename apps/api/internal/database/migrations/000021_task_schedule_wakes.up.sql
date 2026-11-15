-- Presentation-only task edits do not affect notification identities, deadlines
-- or eligibility. INSERT/DELETE still alter the candidate set.
DROP TRIGGER schedule_tasks_dirty ON tasks;
CREATE TRIGGER schedule_tasks_dirty AFTER INSERT OR DELETE ON tasks
 FOR EACH ROW EXECUTE FUNCTION mark_notification_schedule_dirty();
CREATE TRIGGER schedule_tasks_updated AFTER UPDATE ON tasks
 FOR EACH ROW WHEN (
 ROW(OLD.user_id,OLD.id,OLD.scheduled_date,OLD.start_time,OLD.deadline,OLD.status,OLD.deleted_at)
 IS DISTINCT FROM
 ROW(NEW.user_id,NEW.id,NEW.scheduled_date,NEW.start_time,NEW.deadline,NEW.status,NEW.deleted_at)
 ) EXECUTE FUNCTION mark_notification_schedule_dirty();
