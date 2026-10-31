# 05 — Drag-and-Drop Scheduling & Schedule Undo

## Purpose

Drag a task to another day/time or resize it directly on the calendar, and undo the change within 10 seconds — with the deadline enforced by the server.

## Data

| Table | Role |
|-------|------|
| `schedule_undos` | Undo token: `task_id`, the previous schedule (`previous_date`, `previous_start`, `previous_end`), `resulting_revision` (the task's revision right after the move), `expires_at`, `consumed_at` |

## Key rules

- **Single-task / this-occurrence reschedule** is an ordinary mutation: it goes through the command pipeline (doc 10), appends a `task_events` row of kind `updated`, and, when a recurring occurrence changes day, writes a `recurrence_exceptions` row with reason `moved` (doc 06). A move into/out of a past date uses `refreshHistorical` on affected dates (doc 07). **All-occurrences** scheduling uses a separate series edit (`PATCH /tasks/{id}` with `scope: all`), not this `schedule_undos` token flow.
- The server, not the client clock, owns the undo deadline (10 seconds from the token's `created_at` to `expires_at`).
- Undo is valid only when: the token is unexpired, unused (`consumed_at IS NULL`), and the task's current revision still equals `resulting_revision` — if the task was edited again after the move, undo is refused rather than overwriting the newer change.

## Flow

```mermaid
sequenceDiagram
    actor U as User
    participant W as Web (FullCalendar)
    participant A as API
    participant DB as PostgreSQL
    U->>W: Drag task to a new day/time
    W->>A: Reschedule command (expectedRevision)
    A->>DB: Update tasks + task_events
    A->>DB: INSERT schedule_undos (previous schedule, resulting_revision, expires = now + 10s)
    A-->>W: Updated task + undo token
    W-->>U: Show Undo button (10s countdown)
    alt User clicks Undo in time
        U->>W: Undo
        W->>A: Undo command (token)
        A->>DB: Check: unexpired? unused? revision still matches?
        A->>DB: Restore previous schedule, set consumed_at = now
        A-->>W: Task back at its old position
    else 10 seconds pass
        W-->>U: Undo button disappears (token expired server-side)
    end
```

## Undo and recurrence scope

- Undo for a one-task drag/resize is limited by the **server-side 10-second token**. The client countdown is only presentation; an expired token cannot be revived by changing the device clock.
- For a recurring event, prompt for **This occurrence** or **All occurrences**. The latter currently updates the series/template and future materialized occurrences; it does **not** return the 10-second schedule undo token. Do not imply the user can use the same Undo action for series-wide changes.
- A new edit after a successful single-task reschedule changes its revision and invalidates the earlier undo token, preventing stale restoration.
- Task-delete recovery and Stop Repeating recovery are separate flows from schedule undo; their UI toast times do not imply the same server-side expiration contract.
