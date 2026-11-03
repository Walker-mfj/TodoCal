ALTER TABLE auth_sessions ADD COLUMN refresh_expires_at timestamptz;
CREATE TABLE auth_refresh_tokens (
 token_hash text PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
 consumed_at timestamptz
);
CREATE INDEX auth_refresh_session ON auth_refresh_tokens(session_id);
ALTER TABLE push_subscriptions ADD COLUMN device_name text NOT NULL DEFAULT 'Unknown browser';
