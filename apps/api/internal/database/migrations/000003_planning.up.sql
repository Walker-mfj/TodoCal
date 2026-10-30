CREATE TABLE recurrence_series (
 user_id uuid NOT NULL REFERENCES users(id), id uuid NOT NULL,
 template jsonb NOT NULL, group_id uuid, start_date date NOT NULL, cadence text NOT NULL CHECK(cadence IN ('daily','interval','weekly')),
 interval_days integer NOT NULL CHECK(interval_days BETWEEN 1 AND 365), end_date date, stopped_after date,
 deadline_offset integer, deadline_time text, revision bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,id), FOREIGN KEY(user_id,group_id) REFERENCES groups(user_id,id),
 CHECK(end_date IS NULL OR end_date>=start_date)
);
ALTER TABLE tasks ADD COLUMN series_id uuid, ADD COLUMN original_occurrence_date date,
 ADD CONSTRAINT tasks_series_fk FOREIGN KEY(user_id,series_id) REFERENCES recurrence_series(user_id,id),
 ADD CONSTRAINT tasks_occurrence_unique UNIQUE(user_id,series_id,original_occurrence_date),
 ADD CONSTRAINT tasks_occurrence_pair CHECK((series_id IS NULL)=(original_occurrence_date IS NULL));
CREATE TABLE recurrence_exceptions (
 user_id uuid NOT NULL, series_id uuid NOT NULL, original_occurrence_date date NOT NULL,
 task_id uuid, reason text NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,series_id,original_occurrence_date),
 FOREIGN KEY(user_id,series_id) REFERENCES recurrence_series(user_id,id),
 FOREIGN KEY(user_id,task_id) REFERENCES tasks(user_id,id)
);
CREATE TABLE daily_snapshots (
 user_id uuid NOT NULL REFERENCES users(id), date date NOT NULL, timezone text NOT NULL,
 planned integer NOT NULL, completed integer NOT NULL, finalized_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,date), CHECK(completed>=0 AND planned>=completed)
);
CREATE TABLE daily_plan_entries (
 user_id uuid NOT NULL, date date NOT NULL, task_id uuid NOT NULL, task_state jsonb NOT NULL,
 PRIMARY KEY(user_id,date,task_id),
 FOREIGN KEY(user_id,date) REFERENCES daily_snapshots(user_id,date),
 FOREIGN KEY(user_id,task_id) REFERENCES tasks(user_id,id)
);
CREATE TABLE planning_state (
 user_id uuid PRIMARY KEY REFERENCES users(id), caught_up_through date
);
CREATE INDEX task_events_history_idx ON task_events(user_id,task_id,occurred_at DESC);
