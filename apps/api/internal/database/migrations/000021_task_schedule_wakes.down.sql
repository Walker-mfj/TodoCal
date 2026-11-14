DROP TRIGGER schedule_tasks_updated ON tasks;
DROP TRIGGER schedule_tasks_dirty ON tasks;
CREATE TRIGGER schedule_tasks_dirty AFTER INSERT OR UPDATE OR DELETE ON tasks
 FOR EACH ROW EXECUTE FUNCTION mark_notification_schedule_dirty();
