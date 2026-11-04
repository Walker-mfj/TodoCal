ALTER TABLE push_subscriptions DROP COLUMN device_name;
DROP TABLE auth_refresh_tokens;
ALTER TABLE auth_sessions DROP COLUMN refresh_expires_at;
