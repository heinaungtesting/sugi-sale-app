# Prisma Connection and Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the Prisma 7 runtime and CLI foundation and move the database health check from the legacy `pg` helper to Prisma.

**Architecture:** `prisma.config.ts` owns the direct CLI connection, `lib/prisma.ts` owns the pooled runtime client, and the health route uses that singleton. The legacy helper remains temporarily for unmigrated repositories, but it uses the private `DATABASE_URL` rather than a public Supabase HTTP URL.

**Tech Stack:** Next.js 16, TypeScript 5.9, Prisma ORM 7.9, `@prisma/adapter-pg`, PostgreSQL, Vitest

**Spec:** `docs/superpowers/specs/2026-08-17-prisma-supabase-migration-design.md`

## Global Constraints

- Do not run `prisma db push`, `prisma migrate reset`, or any database-changing command.
- Use `DIRECT_URL` only in Prisma CLI configuration and `DATABASE_URL` only at application runtime.
- Never log either connection string or expose it through a `NEXT_PUBLIC_` variable.
- Preserve `lib/db.ts` until its remaining consumers are migrated.
- Keep raw SQL parameterized and only where Prisma model operations cannot express the behavior.
- Do not commit generated Prisma Client output.

---

### Task 1: Prisma configuration and runtime singleton

**Files:**
- Create: `prisma.config.ts`
- Create: `prisma/schema.prisma`
- Create: `lib/prisma.ts`
- Modify: `.gitignore`
- Modify: `.env.example`
- Modify: `lib/db.ts`
- Create: `vitest.config.ts`
- Test: `tests/prisma-foundation.test.ts`

**Interfaces:**
- Consumes: `DIRECT_URL` for Prisma CLI and `DATABASE_URL` for runtime PostgreSQL access.
- Produces: `prisma: PrismaClient` from `lib/prisma.ts` and a transitional `pool` using the same `DATABASE_URL` from `lib/db.ts`.

- [ ] **Step 1: Write a failing source-contract test**

Assert that the Prisma config reads `DIRECT_URL`, the runtime singleton validates and reads `DATABASE_URL`, the adapter selects schema `sugi`, generated output is ignored, `.env.example` has placeholders, and the legacy helper no longer references `NEXT_PUBLIC_SUPABASE_URL`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/prisma-foundation.test.ts`

Expected: FAIL because the Prisma files and environment template do not yet exist.

- [ ] **Step 3: Add the minimal Prisma 7 foundation**

Create the Prisma config, empty PostgreSQL schema with the `prisma-client` generator, and a development-cached Prisma singleton using `PrismaPg`. Restore `.env.example` with placeholder-only values, make the transitional pool fail fast on a missing `DATABASE_URL`, and give Vitest an unreachable test-only URL so source and pure-function tests can import database modules without weakening production validation.

- [ ] **Step 4: Validate and generate without connecting to a database**

Run with placeholder CLI configuration: `$env:DIRECT_URL='postgresql://placeholder:placeholder@localhost:5432/placeholder'; npx prisma validate`

Run: `$env:DIRECT_URL='postgresql://placeholder:placeholder@localhost:5432/placeholder'; npx prisma generate`

Expected: both commands exit 0; neither command connects to or changes a database.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `npm test -- tests/prisma-foundation.test.ts`

Expected: PASS.

### Task 2: Prisma-backed health endpoint

**Files:**
- Modify: `app/api/health/route.ts`
- Modify: `tests/production-readiness.test.ts`

**Interfaces:**
- Consumes: `prisma: PrismaClient` from `lib/prisma.ts`.
- Produces: unchanged `GET()` response contract with `database: 'ok' | 'unexpected-result' | 'unreachable'`.

- [ ] **Step 1: Update the health source-contract test first**

Require the route to import `@/lib/prisma`, call ``prisma.$queryRaw`SELECT 1 AS ok` ``, and stop importing `@/lib/db`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/production-readiness.test.ts`

Expected: FAIL while the route still uses `queryOne`.

- [ ] **Step 3: Migrate the route**

Replace `queryOne` with a typed Prisma `$queryRaw<HealthRow[]>` call and read the first result. Keep metrics, logging, statuses, and response bodies unchanged.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/production-readiness.test.ts tests/prisma-foundation.test.ts`

Expected: PASS.

### Task 3: Verification

**Files:**
- Verify only; no intentional file changes.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: evidence that the migration slice is type-safe and regression-free.

- [ ] **Step 1: Run TypeScript checking**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Review the final diff and secret surface**

Run: `git diff --check`

Run: `rg -n "NEXT_PUBLIC_SUPABASE_URL|DATABASE_URL|DIRECT_URL" --glob '!node_modules/**' --glob '!package-lock.json' .`

Expected: no database URL is read from a public variable; checked-in environment files contain placeholders only.
