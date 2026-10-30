CREATE TABLE schedule_undos (
 user_id uuid NOT NULL REFERENCES users(id), id uuid NOT NULL,
 task_id uuid NOT NULL, previous_date date, previous_start time, previous_end time,
 resulting_revision bigint NOT NULL, created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz,
 PRIMARY KEY(user_id,id), FOREIGN KEY(user_id,task_id) REFERENCES tasks(user_id,id),
 CHECK(expires_at>created_at), CHECK((previous_start IS NULL)=(previous_end IS NULL))
);
CREATE INDEX schedule_undos_expiry_idx ON schedule_undos(expires_at);
