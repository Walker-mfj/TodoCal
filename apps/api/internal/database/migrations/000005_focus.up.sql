CREATE TABLE focus_sessions (
 user_id uuid NOT NULL REFERENCES users(id), id uuid NOT NULL,
 task_id uuid, task_title text,
 kind text NOT NULL CHECK(kind IN ('focus','short_break','long_break')),
 status text NOT NULL CHECK(status IN ('running','paused','completed','ended')),
 target_seconds bigint NOT NULL CHECK(target_seconds>0),
 accumulated_us bigint NOT NULL DEFAULT 0 CHECK(accumulated_us>=0),
 running_since timestamptz, started_at timestamptz NOT NULL, ended_at timestamptz,
 pomodoros integer NOT NULL DEFAULT 0 CHECK(pomodoros IN (0,1)),
 revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(user_id,id), FOREIGN KEY(user_id,task_id) REFERENCES tasks(user_id,id),
 CHECK((status='running') = (running_since IS NOT NULL)),
 CHECK(accumulated_us<=target_seconds*1000000)
);
CREATE UNIQUE INDEX focus_one_active ON focus_sessions(user_id) WHERE status IN ('running','paused');
CREATE INDEX focus_history ON focus_sessions(user_id,started_at DESC);
CREATE TABLE focus_intervals (
 user_id uuid NOT NULL, session_id uuid NOT NULL, ordinal bigint NOT NULL,
 started_at timestamptz NOT NULL, ended_at timestamptz,
 PRIMARY KEY(user_id,session_id,ordinal),
 FOREIGN KEY(user_id,session_id) REFERENCES focus_sessions(user_id,id),
 CHECK(ended_at IS NULL OR ended_at>=started_at)
);
