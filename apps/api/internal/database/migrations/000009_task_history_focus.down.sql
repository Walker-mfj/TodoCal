ALTER TABLE recurrence_series DROP COLUMN stop_undo;
ALTER TABLE daily_snapshots DROP COLUMN revision;
ALTER TABLE task_events DROP COLUMN historical_adjustment;
ALTER TABLE tasks DROP COLUMN focus_minutes, DROP COLUMN completed_at;
