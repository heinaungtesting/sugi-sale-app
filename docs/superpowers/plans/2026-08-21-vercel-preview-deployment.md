# Vercel Preview Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Vercel preview deployment of the initialized Sugi Sale App, verify critical server-backed flows, and stop before production promotion.

**Architecture:** Vercel auto-detects Next.js and builds with `prisma generate` plus `next build`. Preview secrets are configured through Vercel without committing or echoing values. Runtime uses Supabase transaction pooling; migration administration remains outside Vercel builds.

**Tech Stack:** Vercel CLI, Next.js 16, Vercel Functions, Prisma 7, Supabase PostgreSQL

**Spec:** `docs/superpowers/specs/2026-08-21-vercel-supabase-deployment-design.md`

## Global Constraints

- Start only after Supabase initialization passes.
- Deploy Preview first; never add `--prod` until the user explicitly approves production promotion.
- Never pass secrets as visible command-line arguments or print them.
- Vercel build and runtime must not execute schema migrations or seeds.
- Use `DATABASE_URL` transaction pooling for runtime and `DIRECT_URL` only for Prisma configuration/build needs.
- Preserve previous deployments for rollback.

---

### Task 1: Vercel readiness contract

**Files:**
- Create: `tests/vercel-readiness.test.ts`
- Modify: `.env.example`
- Modify: `PRODUCTION.md`

**Interfaces:**
- Produces: a documented exact Preview/Production variable list and source-enforced no-migration build contract.

- [ ] **Step 1: Write failing readiness tests**

Assert `package.json` prebuild contains `prisma generate` but not `migrate`, `db push`, or `seed`; assert `PRODUCTION.md` documents Preview-first deployment, four required Vercel variables, `/api/health`, log inspection, and production approval; assert `.env.example` marks `SUGI_COOKIE_SECURE=true` for Vercel.

- [ ] **Step 2: Update deployment documentation**

Document:

```text
DATABASE_URL       Supabase transaction pooler (:6543)
DIRECT_URL         Supabase direct/session connection (:5432)
SUGI_SESSION_SECRET random 32+ characters
SUGI_COOKIE_SECURE true
```

Include preview deploy, health smoke check, error-log check, production approval, and rollback commands. Do not include real values.

- [ ] **Step 3: Run readiness tests**

Run: `npm test -- tests/vercel-readiness.test.ts tests/production-readiness.test.ts`

Expected: PASS.

### Task 2: Link or create the Vercel project

**Files:**
- Vercel creates ignored `.vercel/project.json`.

**Interfaces:**
- Produces: local link to the chosen Vercel account/team/project.

- [ ] **Step 1: Verify CLI identity read-only**

Use a pinned Vercel CLI invocation and run `whoami`. If authentication is absent, ask the user to complete `vercel login`; do not request or handle account passwords.

- [ ] **Step 2: Present project-link action**

Show the intended account/team and project name `sugi-sale-app`. Ask approval before creating a new external project; linking an existing named project may proceed if the user identifies it.

- [ ] **Step 3: Link without deploying**

Run the pinned CLI `link` command. Verify `.vercel/project.json` contains the expected project/org IDs and remains ignored.

### Task 3: Configure Preview environment variables

**Files:**
- External Vercel Preview environment only.

**Interfaces:**
- Consumes: private local values for `DATABASE_URL`, `DIRECT_URL`, `SUGI_SESSION_SECRET`; literal `true` for `SUGI_COOKIE_SECURE`.

- [ ] **Step 1: List Preview variable names**

Run Vercel environment listing and compare names only. Do not pull or display values.

- [ ] **Step 2: Add or replace variables securely**

Pipe each local value through standard input to the Vercel CLI so it does not appear in process arguments or logs. Apply only to Preview. Confirm the CLI reports each name added without echoing its value.

- [ ] **Step 3: Re-list names and target scopes**

Require all four variables in Preview and no `NEXT_PUBLIC_DATABASE_URL`, `NEXT_PUBLIC_DIRECT_URL`, or `NEXT_PUBLIC_SUGI_SESSION_SECRET` entries.

### Task 4: Deploy and verify Preview

**Files:**
- External Vercel Preview deployment only.

**Interfaces:**
- Produces: immutable preview URL and deployment ID.

- [ ] **Step 1: Run final local gate**

Run Prisma validate/generate, TypeScript, full tests, and production build with private environment injected. Stop on any failure.

- [ ] **Step 2: Deploy Preview with logs**

Run the pinned Vercel CLI deploy command without `--prod`. Capture only the deployment URL/ID and non-secret build status.

- [ ] **Step 3: Verify public and health endpoints**

Require `GET /` status `200` and `/api/health` status `200` with `{ ok: true, database: 'ok' }`. Use Vercel-aware curl if deployment protection is enabled.

- [ ] **Step 4: Verify authenticated flows**

Using the approved administrator, verify login, products, categories, session listing, one labeled test sale, idempotent replay, edit, delete, logout, and session revocation. Never record the PIN, cookies, or CSRF token in the report.

- [ ] **Step 5: Inspect runtime logs**

Check error-level logs for the preview deployment. Require no unhandled database errors and scan returned log text for credential URL prefixes, PIN field names, cookie values, and session tokens.

- [ ] **Step 6: Clean controlled test data**

Delete only the labeled test sale through the normal authorized application flow. Verify the record is absent. Do not delete the approved administrator unless the user requests it.

### Task 5: Production decision boundary

**Files:**
- No changes before approval.

- [ ] **Step 1: Present Preview evidence**

Report deployment URL/ID, build result, health result, tested flows, cleaned test record, and error-log result.

- [ ] **Step 2: Present production configuration action**

Explain that Production needs the same four variable names with production scopes. Ask approval before adding them.

- [ ] **Step 3: Present production promotion action**

After Production variables are confirmed, show the exact `vercel deploy --prod` or promotion command and ask for a separate final confirmation. Do not execute it in this plan without that confirmation.

