DROP INDEX task_events_history_idx;
DROP TABLE planning_state;
DROP TABLE daily_plan_entries;
DROP TABLE daily_snapshots;
DROP TABLE recurrence_exceptions;
ALTER TABLE tasks DROP CONSTRAINT tasks_series_fk, DROP CONSTRAINT tasks_occurrence_unique, DROP CONSTRAINT tasks_occurrence_pair,
 DROP COLUMN series_id, DROP COLUMN original_occurrence_date;
DROP TABLE recurrence_series;
