# Supabase Initialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely initialize the confirmed empty Supabase project from the reviewed Prisma migration, verify it, seed the repository catalog, and create one explicit administrator.

**Architecture:** An operator-only target inspector validates URL mode and target identity without exposing credentials. Prisma applies the immutable migration through `DIRECT_URL`; runtime checks use `DATABASE_URL`. Schema migration, catalog seed, and administrator creation are separate approval-gated operations.

**Tech Stack:** Supabase PostgreSQL, Prisma Migrate 7.9.1, TypeScript, `pg`, bcrypt

**Spec:** `docs/superpowers/specs/2026-08-21-vercel-supabase-deployment-design.md`

## Global Constraints

- Start only after `2026-08-21-prisma-initial-schema.md` passes completely.
- Never print a connection string, database password, session secret, or administrator PIN.
- Never run `prisma db push`, `prisma migrate reset`, or an unreviewed SQL file.
- Treat schema migration, catalog seed, and administrator creation as three separate confirmation boundaries.
- Stop if the target contains unexpected application tables or operational data.
- Use `DIRECT_URL` for migration administration and `DATABASE_URL` for runtime verification.

---

### Task 1: Safe target inspection

**Files:**
- Create: `scripts/inspect-database-target.ts`
- Create: `tests/database-target.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `describeDatabaseTarget(url: string)` returning `{ protocol, host, port, database, user, mode }` with no password; `inspect:db-target` script.

- [ ] **Step 1: Write failing URL-redaction tests**

Test transaction-pooler port `6543`, session/direct port `5432`, missing passwords, malformed URLs, and verify JSON output never contains the password.

- [ ] **Step 2: Implement target parsing and read-only inspection**

Use `new URL(url)` and return only decoded username, hostname, port, database path, and `mode: 'transaction' | 'session-or-direct' | 'unknown'`. The executable queries current database, current user, current schema, migration history count, and application-table names; it prints identifiers and counts only.

- [ ] **Step 3: Run tests and inspect both configured targets**

Run `npm run inspect:db-target` separately for `DIRECT_URL` and `DATABASE_URL`. Confirm both identify the same Supabase project/database while reporting different connection modes as expected.

- [ ] **Step 4: Stop if connectivity or identity is uncertain**

Do not repair URLs by guessing. Obtain corrected strings from Supabase Dashboard → Connect, then repeat inspection.

### Task 2: Apply the reviewed migration

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: reviewed migration hash and `DIRECT_URL`.
- Produces: initialized `sugi` schema and Prisma migration history.

- [ ] **Step 1: Confirm emptiness read-only**

Require zero existing Sugi application tables and no unexpected `_prisma_migrations` history. Record only counts and names.

- [ ] **Step 2: Present the irreversible command for approval**

Show the redacted target identity, migration directory name/hash, and:

```powershell
.\node_modules\.bin\prisma.cmd migrate deploy
```

Wait for explicit approval.

- [ ] **Step 3: Apply exactly once**

Run the approved command with `DIRECT_URL` loaded from the private local environment. Do not use the transaction-pooler runtime URL.

- [ ] **Step 4: Verify structure and idempotency**

Run `npm run verify:prisma-schema`, inspect Prisma migration history, then run `prisma migrate deploy` a second time and require “No pending migrations”.

- [ ] **Step 5: Verify runtime connectivity**

Execute the same typed Prisma `SELECT 1 AS ok` used by `/api/health` through `DATABASE_URL`; require `{ ok: 1 }` without printing connection details.

### Task 3: Catalog seed

**Files:**
- Create: `prisma/seed.ts`
- Create: `tests/prisma-seed.test.ts`
- Modify: `prisma.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `data/local-product-catalog.json`.
- Produces: explicit `npm run seed:catalog` command and idempotent product/variant counts.

- [ ] **Step 1: Write failing catalog normalization tests**

Test deterministic normalization, duplicate product handling, duplicate variant handling, and stable counts using a small fixture. Assert rerunning produces the same logical upsert keys.

- [ ] **Step 2: Implement transactional catalog upsert**

Use Prisma model operations for products and variants. Use a transaction per product family, `upsert` on product name and `(productId, variantLabel)`, and map bigint IDs internally. Print only inserted/updated/skipped counts.

- [ ] **Step 3: Configure explicit seed command**

Set `migrations.seed` to `tsx prisma/seed.ts` and add `"seed:catalog": "tsx prisma/seed.ts"`. Do not run it automatically from build, start, or migration deploy.

- [ ] **Step 4: Verify locally against a disposable database**

Run seed twice; require identical product/variant totals and zero duplicate keys.

- [ ] **Step 5: Present Supabase seed approval**

Show source file hash and expected counts. Wait for explicit approval before `npm run seed:catalog` against Supabase.

- [ ] **Step 6: Seed and verify counts**

Run once against Supabase, compare expected and actual active product/variant counts, and stop on mismatch.

### Task 4: Explicit administrator creation

**Files:**
- Create: `scripts/create-admin.ts`
- Create: `tests/create-admin.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run create:admin -- <username> <display-name>`; PIN is read from hidden interactive input or `SUGI_NEW_ADMIN_PIN`, never a positional argument.

- [ ] **Step 1: Write failing validation tests**

Test normalized username, non-empty display name, PIN length/format, bcrypt hash creation, and that formatted summaries omit the PIN and hash.

- [ ] **Step 2: Implement secure explicit creation**

Use Prisma `sugiUser.create`; reject an existing username instead of silently promoting it. Require role `admin`, `isActive: true`, and bcrypt cost `10`. Print only created ID, username, and role.

- [ ] **Step 3: Verify against disposable PostgreSQL**

Create a disposable admin, verify bcrypt comparison and role, then delete only that known test row.

- [ ] **Step 4: Present Supabase creation approval**

Show normalized username/display name and redacted target identity. Wait for explicit approval and never display the PIN.

- [ ] **Step 5: Create and verify the administrator**

Run once, verify the row is active/admin, and perform a direct authentication-service test without logging tokens or cookies.

### Task 5: Supabase initialization checkpoint

**Files:**
- Verify only.

- [ ] **Step 1: Run full local verification**

Run Prisma validate/generate, TypeScript, full tests, build, and `git diff --check`.

- [ ] **Step 2: Run read-only Supabase verification**

Confirm migration history, schema object inventory, zero unexpected tables, catalog counts, exactly the approved administrator, and `/api/health` query success.

- [ ] **Step 3: Record rollback facts**

Record that the database migration is forward-only and that no operational sales exist yet. Do not drop or reset the schema for rollback.

- [ ] **Step 4: Stop before Vercel external changes**

Present verification results and request approval to link/create a Vercel project and configure Preview secrets.

