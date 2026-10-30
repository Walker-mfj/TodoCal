CREATE TABLE groups (
 user_id uuid NOT NULL REFERENCES users(id), id uuid NOT NULL,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 color text NOT NULL CHECK(color ~ '^#[0-9a-fA-F]{6}$'), revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(user_id,id)
);
CREATE TABLE tasks (
 user_id uuid NOT NULL REFERENCES users(id), id uuid NOT NULL,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 300), description text NOT NULL DEFAULT '',
 group_id uuid, priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
 scheduled_date date, start_time time, end_time time, deadline timestamptz,
 status text NOT NULL DEFAULT 'incomplete' CHECK(status IN ('incomplete','complete')),
 estimated_pomodoros integer CHECK(estimated_pomodoros>0), revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, deleted_at timestamptz,
 PRIMARY KEY(user_id,id), FOREIGN KEY(user_id,group_id) REFERENCES groups(user_id,id),
 CHECK((start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL AND scheduled_date IS NOT NULL AND end_time>start_time))
);
CREATE INDEX tasks_live_idx ON tasks(user_id,id) WHERE deleted_at IS NULL;
CREATE INDEX tasks_schedule_idx ON tasks(user_id,scheduled_date) WHERE deleted_at IS NULL;
CREATE TABLE task_events (
 user_id uuid NOT NULL, id uuid NOT NULL, task_id uuid NOT NULL, kind text NOT NULL,
 occurred_at timestamptz NOT NULL, local_date date NOT NULL, timezone text NOT NULL,
 before_state jsonb, after_state jsonb, invalidated_at timestamptz,
 PRIMARY KEY(user_id,id), FOREIGN KEY(user_id,task_id) REFERENCES tasks(user_id,id)
);
CREATE INDEX task_events_date_idx ON task_events(user_id,local_date,kind);
CREATE TABLE mutation_receipts (
 user_id uuid NOT NULL REFERENCES users(id), idempotency_key text NOT NULL,
 request_hash text NOT NULL, response_status integer NOT NULL, response_body bytea NOT NULL,
 created_at timestamptz NOT NULL, PRIMARY KEY(user_id,idempotency_key)
);
