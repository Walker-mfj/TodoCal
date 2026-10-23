# Local operations and recovery

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Go API/worker PostgreSQL connection string. Keep real credentials outside Git. |
| `API_ADDR` | Go listener, default `127.0.0.1:8080`. |
| `APP_ORIGIN` | Exact browser origin for mutation Origin validation, default `http://localhost:3000`. |
| `COOKIE_SECURE` | Defaults from HTTPS origin; HTTPS cannot disable Secure cookies. HTTP is allowed only for local origins. |
| `API_URL` | Next.js rewrite destination, default local Go API. Set before build for production start. |

Follow README for `make db-up`, `make migrate`, API/web/worker startup. Migrations are explicit, ordered and embedded in the Go binary. Back up before schema changes. Apply migrations with the matching release binary before restarting services. `/healthz` checks the process; `/readyz` checks PostgreSQL connectivity.

Sessions are opaque, hashed in PostgreSQL, expire after seven days, and use HttpOnly/SameSite=Lax cookies. Mutations enforce Origin, JSON content type and CSRF tokens. Account IDs come from the authenticated session; nested references remain owner-scoped. Password changes revoke other sessions. No email recovery service is included.

Writes require a connection. An uncertain retry must preserve its exact method, URI, JSON bytes and idempotency key. Do not issue a new key merely because the response was lost. Stale revisions return conflicts. Visible browser pages refresh every 15 seconds and on focus/reconnect; browser hints are not authoritative data. Worker downtime is recoverable through persisted catch-up and the API's fallback.

## Backup and restore rehearsal

`make test-operations` builds the API and uses a new disposable PostgreSQL 18.3 container with synthetic fixtures. It binds only to loopback, uses temporary trust authentication, and removes only its own container and volume on exit. Python 3 and Docker are required. It verifies migration 5 → 6 → 5 → 6, repeat migration safety, API reconnect after database outage, every public table's restored rows and the focus identity sequence. This does not validate destructive rollback of all older migrations.

For a real local backup, set `PGSERVICE` to a locally configured PostgreSQL service (with credentials in a protected PostgreSQL password file), then run:

```sh
pg_dump --format=custom --file=focus-backup.dump
pg_restore --list focus-backup.dump
```

Keep backups outside the repository with restricted access; they contain private account data and password/session hashes. Test recovery into a **new empty database**, never overwrite the live database as a rehearsal. Configure a separate service for that empty target:

```sh
PGSERVICE=focus_restore pg_restore --exit-on-error --single-transaction --dbname=service=focus_restore focus-backup.dump
PGSERVICE=focus_restore psql -c 'SELECT version, dirty FROM schema_migrations;'
```

Verify representative accounts, tasks, recurrence, finalized plans and focus history before pointing any application at the recovered database. Run the matching app release and confirm `/readyz`, sign-in and reports. Keep the original database intact until recovery has been accepted.

Rollback SQL is not a general data recovery strategy: older down migrations drop feature tables. Stop writers and take a backup before a real rollback. The rehearsal specifically checks reversible migration 6 with existing data; for a destructive downgrade restore a compatible backup into a new database and use the corresponding application version. Never manually clear a dirty migration flag without investigating the failed transaction.

`docker compose stop` preserves the local data volume. Commands that remove volumes delete data and are not part of normal startup/shutdown.
