ALTER TABLE tasks ADD COLUMN focus_minutes integer CHECK(focus_minutes BETWEEN 1 AND 180), ADD COLUMN completed_at timestamptz;
UPDATE tasks t SET completed_at=COALESCE((SELECT max(occurred_at) FROM task_events e WHERE e.user_id=t.user_id AND e.task_id=t.id AND e.kind='completed' AND e.invalidated_at IS NULL),t.updated_at) WHERE status='complete';
ALTER TABLE task_events ADD COLUMN historical_adjustment boolean NOT NULL DEFAULT false;
ALTER TABLE daily_snapshots ADD COLUMN revision bigint NOT NULL DEFAULT 1;
ALTER TABLE recurrence_series ADD COLUMN stop_undo jsonb;
