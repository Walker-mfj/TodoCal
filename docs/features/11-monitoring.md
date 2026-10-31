# 11 — Error Monitoring

## Purpose

Send API and browser errors to Better Stack (Sentry protocol) for production visibility — but in a disciplined way: scrubbed of sensitive content, deduplicated, and capped by a hard daily budget so an infinitely repeating error cannot burn the whole quota.

## Data

| Table | Role |
|-------|------|
| `monitoring_budget` | Exactly one row system-wide (`singleton = true`): `day`, `used` — how many events have been consumed today |

## Defense layers (outside in)

1. **Browser error ingest endpoint**: at most 20 requests/minute, body capped at 32 KiB, at most 3 exceptions per payload.
2. **Inside each instance**: identical events are deduplicated within 5 minutes (by content hash), at most 10 events/minute, queue capped at 16.
3. **Shared database budget**: at most **1000 events/day** (`DailyLimit`) across *all* instances and both sources (API + browser). Every event must atomically reserve a slot in `monitoring_budget` before being sent — the counter resets on a new day. **Fail-closed**: if the reservation fails, nothing is sent.

## Scrubbing before send

- Error messages are replaced with a generic string ("Error details removed for privacy") — raw error text is never sent.
- Stack traces keep only the file basename, validated function names, and line numbers; at most 30 frames and 3 exceptions.
- Browser frames are kept only if they belong to `/_next/static/`.

## Flow

```mermaid
flowchart TD
    A[API error - panic / error] --> R[Reporter]
    B[Browser error] --> C[Ingest POST via API<br/>limiter 20/minute]
    C --> R
    R --> S[Sanitize: strip raw messages<br/>filter stack traces]
    S --> D{Identical event already sent<br/>within 5 minutes?}
    D -->|Yes| X[Drop]
    D -->|No| E{Instance over<br/>10 events/minute?}
    E -->|Yes| X
    E -->|No| F[Reserve a slot in monitoring_budget<br/>used + 1 if still under 1000/day]
    F -->|Budget exhausted / DB error| X
    F -->|Reserved| G[Send to Better Stack]
```

## Operational policy and gaps

- The shared daily budget is system-wide; metrics such as **events dropped by rate limiter, deduplication, queue overflow, and exhausted budget** should be tracked separately from events accepted. These are operational visibility recommendations, not claims about existing dashboards.
- Incident responders must not depend on raw message bodies because privacy scrubbing intentionally removes them. Use issue fingerprint, safe stack frames, release/version, and generic error class where available.
- **Recommended runbook:** alert on an unusual error-rate increase or exhausted budget; inspect safe telemetry and deployment version; document how to rotate credentials and retry when the provider is unavailable. Provider outage must not block user mutations.
- **Pending policy decisions:** retention for budget/telemetry records, monitoring access controls, and UTC-vs-account-local day boundary for the **system-wide** budget should be documented explicitly. Do not imply a per-user budget.

Acceptance checks: scrubbing removes secrets, budget reservation is atomic across API instances, and monitoring transport failure cannot make a completed business command fail retroactively.
