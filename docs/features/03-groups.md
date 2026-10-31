# 03 — Groups

## Purpose

Classify tasks into named, colored groups — the group color is the border color of the task's calendar event, and group is one of the toolbar filter dimensions.

## Data

| Table/column | Role |
|--------------|------|
| `groups` | `name` (1–100 characters), `color` in `#RRGGBB` form, `revision`; primary key `(user_id, id)` |
| `tasks.group_id` | FK `(user_id, group_id)` → `groups`; `NULL` means no group |

## Key rules

- Name and color are validated both in the database (CHECK constraints) and in the service layer.
- Deleting a group **does not delete its tasks**: each affected task is ungrouped (`group_id = NULL`) and gets its own event with `kind = 'group_cleared'`. This event is special: it does *not* trigger `refreshHistorical`, because ungrouping must not rewrite finalized-day statistics — old snapshots keep the group name/color as of finalization time (stored inside `daily_plan_entries.task_state`).
- Renaming/recoloring a group also uses optimistic concurrency (`expectedRevision`).

## Delete-group flow

```mermaid
flowchart TD
    A[User deletes group] --> B[Load all tasks in the group]
    B --> C[For each task: group_id = NULL<br/>append Event 'group_cleared']
    C --> D[Delete the groups row]
    D --> E[Calendar: tasks still shown<br/>without the group border color]
    C -.->|Never touches| F[(daily_plan_entries<br/>finalized-day snapshots<br/>keep the old name/color)]
```
