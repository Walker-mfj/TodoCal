ALTER TABLE focus_sessions ADD COLUMN sequence bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX focus_last_session ON focus_sessions(user_id,sequence DESC);
