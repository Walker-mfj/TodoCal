CREATE TABLE users (
 id uuid PRIMARY KEY,
 email text NOT NULL UNIQUE,
 password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE settings (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 timezone text NOT NULL DEFAULT 'UTC',
 appearance text NOT NULL DEFAULT 'light' CHECK (appearance IN ('light','dark')),
 focus_minutes integer NOT NULL DEFAULT 25 CHECK (focus_minutes > 0),
 short_break_minutes integer NOT NULL DEFAULT 5 CHECK (short_break_minutes > 0),
 long_break_minutes integer NOT NULL DEFAULT 15 CHECK (long_break_minutes > 0),
 sound boolean NOT NULL DEFAULT true,
 revision bigint NOT NULL DEFAULT 1
);
CREATE TABLE auth_sessions (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE,
 csrf_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);
CREATE TABLE auth_attempts (
 key text PRIMARY KEY,
 attempts integer NOT NULL,
 window_start timestamptz NOT NULL
);
