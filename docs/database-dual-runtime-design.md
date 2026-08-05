# Dual Database Runtime Design

## Purpose

This document defines the recommended design for running MySQL and PostgreSQL concurrently in Project Billing System.

It is a design document only.

It does not describe implemented behavior yet.

## 1. Design Goal

Support controlled operation of both databases with explicit admin-selected runtime modes:

- MySQL primary
- PostgreSQL primary
- MySQL only
- PostgreSQL only
- Maintenance

The design must let admin:

- choose the active write database
- stop or isolate one database without shutting down the whole app
- promote one database to primary
- block writes during maintenance
- monitor replication and drift

## 2. Recommended Operating Principle

The safest design is:

- one writable primary database at a time
- one optional secondary database
- application-level replication from primary to secondary
- reads served from the primary database by default
- manual failover by admin

This is preferred over native cross-engine replication because MySQL and PostgreSQL are different engines with different transaction and feature behavior.

## 3. Runtime Modes

### `mysql_primary`

- MySQL: read/write
- PostgreSQL: replicated, read-only

Expected behavior:

- all normal writes go to MySQL
- PostgreSQL receives replicated changes from sync pipeline
- normal user reads also come from MySQL

### `postgres_primary`

- PostgreSQL: read/write
- MySQL: replicated, read-only

Expected behavior:

- all normal writes go to PostgreSQL
- MySQL receives replicated changes from sync pipeline
- normal user reads also come from PostgreSQL

### `mysql_only`

- MySQL: read/write
- PostgreSQL: disabled

Expected behavior:

- app reads and writes use MySQL only
- PostgreSQL is not used for user traffic

### `postgres_only`

- PostgreSQL: read/write
- MySQL: disabled

Expected behavior:

- app reads and writes use PostgreSQL only
- MySQL is not used for user traffic

### `maintenance`

- MySQL: no writes
- PostgreSQL: no writes

Expected behavior:

- write APIs return maintenance response
- reads may remain enabled for admin and normal users, depending on final operational choice

Recommended first version:

- allow reads
- block all POST, PUT, DELETE writes

## 4. Read and Write Routing Rules

### Write routing

All write operations must pass through a single routing layer.

That routing layer decides:

- whether writes are allowed
- which database receives the write
- whether sync events must be queued for the secondary database

Write destinations by mode:

- `mysql_primary` -> MySQL
- `postgres_primary` -> PostgreSQL
- `mysql_only` -> MySQL
- `postgres_only` -> PostgreSQL
- `maintenance` -> reject writes

### Read routing

Recommended first version:

- always read from the current primary/write database

Reason:

- simplest consistency model
- avoids stale replica data in user workflows
- easier operational debugging

Replica reads can be added later for reporting if needed.

## 5. Replication Strategy

### Recommendation

Use application-level asynchronous replication with an outbox/sync queue.

### Why

Because the system needs to replicate between:

- MySQL
- PostgreSQL

and those engines should not be treated as interchangeable native cluster members.

### Replication flow

1. app writes successfully to primary DB
2. app records sync event in outbox table
3. sync worker reads pending events
4. sync worker applies equivalent mutation to secondary DB
5. event marked success or failed with retry metadata

### Sync direction

Only one active sync direction at a time:

- MySQL -> PostgreSQL when MySQL is primary
- PostgreSQL -> MySQL when PostgreSQL is primary

## 6. Failure Model

### Primary write DB failure

If current primary is unavailable:

- do not auto-promote secondary in first version
- raise degraded/critical state
- require explicit admin promotion

### Secondary sync failure

If replica update fails:

- primary app traffic continues
- failed sync stays in queue
- admin dashboard shows degraded replication status

### Why manual failover first

Manual failover is safer because:

- cross-engine failover can hide drift
- app-level replication may lag
- promotion should happen only after admin confirms state

## 7. Maintenance Mode Behavior

### Recommended behavior

When mode is `maintenance`:

- all write endpoints reject requests
- timesheet submit is blocked
- admin create/update actions are blocked
- reads remain available
- UI displays maintenance banner

Recommended response:

- HTTP `503`
- message: `System is in maintenance mode. Writes are temporarily disabled.`

## 8. Configuration Model

The runtime needs one authoritative mode record.

### Recommended table

`system_runtime_mode`

Suggested fields:

- `id`
- `mode`
- `mysql_enabled`
- `postgres_enabled`
- `primary_db`
- `write_enabled`
- `changed_by_employee_id`
- `changed_at`
- `note`

The actual source of truth should be the mode itself, not separate booleans independently edited without rules.

## 9. Sync Metadata Tables

### `db_sync_queue`

Purpose:

- outbox queue for cross-database replication

Suggested fields:

- `id`
- `source_db`
- `target_db`
- `entity_type`
- `entity_id`
- `operation`
- `payload_json`
- `status`
- `attempt_count`
- `last_error`
- `created_at`
- `processed_at`

### `db_sync_state`

Purpose:

- current operational sync state

Suggested fields:

- `sync_direction`
- `enabled`
- `last_success_at`
- `last_failure_at`
- `last_error`
- `pending_count`
- `failed_count`
- `lag_seconds`

### `db_health_status`

Purpose:

- capture per-database health checks

Suggested fields:

- `database_name`
- `connected`
- `readable`
- `writable`
- `last_checked_at`
- `last_error`

## 10. Application Architecture Changes

### Required service layer

Introduce a database runtime coordinator service responsible for:

- current mode lookup
- read routing
- write routing
- maintenance enforcement
- sync event creation

Suggested name:

- `databaseRuntimeService`

### Repository pattern impact

Repositories should no longer write directly to one DB without routing context.

Instead:

- repositories become engine-specific or neutral adapters
- service layer picks target connection/provider

Possible structure:

- `repositories/mysql/...`
- `repositories/postgres/...`
- `services/database-runtime.service.js`
- `services/database-sync.service.js`

## 11. Entity Scope for Replication

The following entities should be included in first-wave replication design:

- employees
- teams
- projects
- project-team assignments
- project-manager assignments
- kits
- time entries
- time-entry-kit links
- application settings

## 12. Mode Transition Rules

### Transition: `mysql_primary` -> `postgres_primary`

Recommended safe flow:

1. verify PostgreSQL is connected
2. verify replication queue is empty or acceptable
3. pause new mode switch operations
4. promote PostgreSQL to primary
5. set MySQL to replica/read-only
6. reverse sync direction
7. publish status/event log

### Transition: `mysql_primary` -> `maintenance`

1. block writes
2. allow sync queue to drain if desired
3. show maintenance status to UI

### Transition: `mysql_only` -> `mysql_primary`

1. verify PostgreSQL available
2. enable PostgreSQL as replica target
3. initialize or catch up sync
4. mark mode `mysql_primary`

## 13. Admin UI Design

The admin dashboard should eventually expose a dedicated database runtime area.

### Recommended sections

#### Current mode

- selected mode
- active primary DB
- write status

#### Database health

- MySQL connected/readable/writable
- PostgreSQL connected/readable/writable

#### Replication status

- direction
- queue depth
- failed items
- lag

#### Actions

- switch to MySQL primary
- switch to PostgreSQL primary
- switch to MySQL only
- switch to PostgreSQL only
- enter maintenance mode
- retry failed syncs

#### Audit log

- who changed mode
- when
- why/note

## 14. Recommended API Endpoints

These endpoints are proposed for the future design:

### Read status

- `GET /api/admin/database-runtime`
- `GET /api/admin/database-runtime/health`
- `GET /api/admin/database-runtime/sync-status`

### Mode changes

- `POST /api/admin/database-runtime/mode`

Request example:

```json
{
  "mode": "mysql_primary",
  "note": "Promoting MySQL after PostgreSQL maintenance"
}
```

### Sync actions

- `POST /api/admin/database-runtime/sync/retry-failed`
- `POST /api/admin/database-runtime/sync/pause`
- `POST /api/admin/database-runtime/sync/resume`

## 15. Authorization Rules

Only admin users should be able to:

- change runtime mode
- pause/resume replication
- promote primary
- enter maintenance mode

Managers and employees should never control DB mode.

## 16. Observability Requirements

The final implementation should log:

- mode changes
- failed sync events
- queue backlog growth
- health-check failures
- maintenance mode entry and exit

Recommended destinations:

- application logs
- admin audit table
- dashboard counters

## 17. Recommended Rollout Plan

### Phase 1

- document design
- define mode table
- define sync queue model

### Phase 2

- build runtime coordinator
- route writes to active primary
- block writes in maintenance mode

### Phase 3

- build one-way replication queue
- expose health and queue status in admin UI

### Phase 4

- add safe promotion workflow
- add replay/retry and drift reporting

## 18. Final Recommendation

The recommended first implementation should be conservative:

- single primary writer
- async app-level replication
- reads from primary only
- manual failover only
- maintenance blocks writes only

This gives the system:

- clear operational behavior
- lower risk
- simpler debugging
- safer future expansion

## 19. Related Documents

- [README.md](/C:/Users/testpc/Desktop/office/README.md)
- [docs/admin-technical-guide.md](/C:/Users/testpc/Desktop/office/docs/admin-technical-guide.md)
- [docs/timesheet-technical-guide.md](/C:/Users/testpc/Desktop/office/docs/timesheet-technical-guide.md)
