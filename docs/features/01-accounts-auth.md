# 01 — Accounts & Authentication

## Purpose

Registration, login, logout, password changes, and personal settings (time zone, appearance, Pomodoro defaults). All of a user's data is isolated by `user_id` in every table.

## Data

| Table | Role |
|-------|------|
| `users` | Account: `id`, `email` (unique), `password_hash`, `created_at` |
| `settings` | One row per user: `timezone` (default `UTC`), `appearance` light/dark, `focus_minutes` 25, `short_break_minutes` 5, `long_break_minutes` 15, `sound`, `revision` |
| `auth_sessions` | Login sessions: `token_hash`, `csrf_hash`, `expires_at`, `revoked_at` |
| `auth_attempts` | Counts failed login attempts per key to throttle brute force |

## Key rules

- Passwords are stored only as hashes; session and CSRF tokens are also stored only as hashes (`token_hash`, `csrf_hash`).
- Revoking a session (logout / password change) sets `revoked_at` — the session dies immediately instead of waiting for expiry.
- Every write request **revalidates the session inside its transaction** (`ValidateOwnedSession` in `Execute`), so revocation takes effect instantly.
- `settings.revision` follows the same optimistic-concurrency rule as every other entity: a wrong `expectedRevision` returns 409.

## Login flow

```mermaid
sequenceDiagram
    actor U as User
    participant W as Web
    participant A as API
    participant DB as PostgreSQL
    U->>W: Enter email + password
    W->>A: POST /auth/login
    A->>DB: Check auth_attempts (locked out?)
    alt Too many failures
        DB-->>A: Still inside the lockout window
        A-->>W: Rejected (rate limited)
    else Attempt allowed
        A->>DB: Load user by email, compare password_hash
        alt Wrong password
            A->>DB: Increment auth_attempts
            A-->>W: 401
        else Correct
            A->>DB: Create auth_sessions (store token_hash + csrf_hash)
            A->>DB: Create default settings if missing
            A-->>W: Session cookie + CSRF token
            W-->>U: Enter the app
        end
    end
```

## Session lifecycle

```mermaid
flowchart TD
    A[Login succeeds] --> B[auth_sessions: revoked_at = NULL]
    B --> C{Session still valid?}
    C -->|Revalidated on every mutation| D{Not expired and not revoked}
    D -->|Yes| E[Operation allowed]
    D -->|Past expires_at| F[401 - sign in again]
    B --> G[Logout / password change]
    G --> H[Set revoked_at = now]
    H --> F
```
