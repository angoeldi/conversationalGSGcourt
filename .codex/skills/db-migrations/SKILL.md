---
name: db-migrations
description: Use when changing Postgres tables, adding JSONB fields, or writing migrations.
---

# DB Migrations skill

## Objective
Evolve the Postgres schema safely, keeping event log and snapshots consistent.

## Trigger examples
- "Add a table to store adviser perceptions"
- "Index provinces for map rendering"

## Workflow
1. Identify whether the change is:
   - new persisted entity
   - new JSONB field in existing table
   - a performance/index change

2. Write a new migration file
   - `apps/server/sql/####_short_name.sql` (monotonic numbering)
   - Never edit past migrations once shared.

3. Maintain compatibility
   - Prefer additive changes (new columns/tables) over breaking changes.
   - If you must change semantics, add a new column and backfill.

4. Update docs
   - `docs/db.md` and any affected schemas.

5. Run locally
   - `docker compose up -d`
   - `pnpm --filter @thecourt/server db:migrate`

## Output expectations
- Migration runs cleanly on an empty DB and on an existing DB.
