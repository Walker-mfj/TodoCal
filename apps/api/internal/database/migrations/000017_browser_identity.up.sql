ALTER TABLE auth_sessions ADD COLUMN browser_id uuid;
CREATE INDEX auth_session_browser ON auth_sessions(user_id,browser_id);
