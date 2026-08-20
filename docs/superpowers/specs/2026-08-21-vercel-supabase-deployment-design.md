# Vercel and Supabase Deployment Design

**Date:** 2026-08-21  
**Status:** Approved in chat; awaiting written-spec review  
**Scope:** Prepare and deploy the authenticated Sugi Sale App to Vercel with Supabase PostgreSQL, first as a verified preview and then as an explicitly approved production deployment.

## 1. Current state

The application builds as a Next.js 16 project and has the first Prisma 7 runtime slice:

- `lib/prisma.ts` creates a Prisma Client through `@prisma/adapter-pg`.
- `/api/health` verifies connectivity with a safe Prisma raw `SELECT 1` query.
- Remaining product, user, session, sales, administration, campaign, rate-limit, and enrichment paths still use parameterized `pg` code through `lib/db.ts`.
- `prisma/schema.prisma` contains no models and there are no Prisma migrations.
- Required local environment-variable names exist, but the read-only Supabase connectivity probe did not establish a connection.
- The checkout is not linked to a Vercel project and the Vercel CLI is not installed.
- The working tree contains the uncommitted Prisma foundation and must be preserved.

Deploying the current tree without initializing its database would produce a build but leave database-backed routes unavailable.

## 2. Goals

1. Reproduce the complete Sugi PostgreSQL schema through reviewed Prisma migration files.
2. Keep Prisma Client as the default for application persistence while retaining centralized, parameterized raw SQL where Prisma cannot safely express PostgreSQL-specific behavior.
3. Configure Vercel Functions to use Supabase's serverless transaction pooler at runtime.
4. Keep migrations on a direct or session-pooled administrative connection, never the serverless transaction pooler.
5. Deploy and verify a Vercel preview before production promotion.
6. Preserve an explicit confirmation boundary before any Supabase schema change, seed, administrator creation, or Vercel production deployment.

## 3. Non-goals

- Recovering or modifying the old iPhone PWA data.
- Reintroducing the deleted DigitalOcean database.
- Adding Supabase Auth, Storage, Realtime, or browser-side table access.
- Running migrations during `next build`, Vercel build, or application startup.
- Rewriting PostgreSQL-specific queries merely to eliminate all SQL.
- Automatically importing guessed users or historical sales.
- Exposing database URLs through `NEXT_PUBLIC_*` variables.

## 4. Chosen approach

Use a migration-first preview deployment:

```text
reviewed Prisma migration
          |
 explicit migration deploy through DIRECT_URL
          |
 Supabase PostgreSQL (sugi schema)
          |
 DATABASE_URL via transaction pooler :6543
          |
 Vercel Functions / Next.js routes
          |
 preview smoke tests
          |
 explicit production promotion approval
```

The first preview may use the intended production Supabase project only while it contains no operational data. Test users and sales must be clearly identified and removed after verification. Once operational data exists, preview deployments require a separate database or Supabase branch before write-path testing.

### Alternatives rejected

1. **Deploy immediately:** the UI could build, but database-backed health, authentication, products, and sales would fail because no schema migration exists.
2. **Deploy only `/local`:** device-only IndexedDB would work, but this would not deploy the authenticated multi-user application requested here.
3. **Keep the Docker-only host:** compatible with the existing long-running process, but does not meet the Vercel deployment goal.

## 5. Database and Prisma design

The initial Prisma migration must cover every table currently created by `scripts/migrate.ts` and the enrichment schema assets:

- `sugi_users`
- `sugi_sessions`
- `sugi_rate_limits`
- `sugi_point_campaigns`
- `sugi_point_campaign_items`
- `sugi_activity_logs`
- `sugi_feedback`
- `products`
- `product_variants`
- `sales_logs`
- `sale_idempotency_receipts`
- enrichment source, job, feature, summary, and audit tables

Prisma models map existing snake_case tables and columns with `@@map` and `@map`. The migration retains reviewed custom SQL for PostgreSQL features that Prisma's schema language cannot fully represent:

- `pg_trgm`
- generated columns
- partial indexes
- GIN and trigram indexes
- check constraints
- `UNLOGGED` rate-limit storage
- array and JSONB defaults
- specialized atomic statements and concurrency-sensitive claims

The initial migration is generated or assembled locally and reviewed before it touches Supabase. No `prisma db push` or `prisma migrate reset` is permitted against Supabase. Once applied, migration files are immutable.

## 6. Vercel environment design

Vercel Preview and Production receive these server-only variables:

| Variable | Value type | Purpose |
|---|---|---|
| `DATABASE_URL` | Supabase transaction-pooler PostgreSQL URL, normally port `6543` | Runtime Prisma and transitional `pg` traffic |
| `DIRECT_URL` | Supabase direct URL or session-pooler PostgreSQL URL, normally port `5432` | Prisma generation/configuration and explicit migration administration |
| `SUGI_SESSION_SECRET` | Random secret of at least 32 characters | Session signing |
| `SUGI_COOKIE_SECURE` | `true` | HTTPS-only session cookies |

`SIGMA_RAG_PG_DSN` is not required by Vercel request handling. It remains relevant only to legacy local migration, backup, and restore scripts until those operational paths are replaced. No real secret is committed or printed in logs.

The runtime pool stays module-scoped for function-instance reuse. Its maximum size must remain deliberately small, and Supabase's transaction pooler absorbs serverless fan-out. A later optimization may attach the underlying `pg` pool to Vercel Fluid Compute lifecycle handling, but it is not required for the first low-traffic preview.

## 7. Build and release workflow

The Vercel build performs only deterministic application work:

1. Install locked dependencies.
2. Run `prisma generate`.
3. Generate build metadata.
4. Run `next build`.

It does not migrate, seed, or create users.

The first release sequence is:

1. Validate the actual Supabase URL modes without displaying credentials.
2. Rehearse the initial migration against a disposable PostgreSQL database.
3. Verify tables, constraints, indexes, and generated columns.
4. Present the exact migration command and target identity for approval.
5. Apply the reviewed migration to the confirmed empty Supabase project.
6. Verify migration history and schema objects read-only.
7. Import only the repository-controlled product catalog after separate approval.
8. Create a new administrator through a secure explicit command after separate approval.
9. Link or create the Vercel project.
10. Configure Preview environment variables without echoing their values.
11. Deploy a preview and verify it.
12. Configure Production variables.
13. Present the production promotion for final approval.
14. Promote the verified build and verify the production URL.

## 8. Preview verification

The preview is not successful merely because Vercel reports a completed build. Verification includes:

- `GET /` returns `200` and renders the login/application shell.
- `GET /api/health` returns `200` with `database: "ok"`.
- Login succeeds for the explicitly created test administrator.
- Products and categories load from Supabase.
- One clearly labeled test sale succeeds.
- Replaying the same idempotency key does not duplicate the sale.
- Edit and delete behavior works for the test sale.
- Session listing and logout/revocation work.
- Vercel runtime logs contain no database URLs, PINs, session tokens, or stack traces returned to clients.
- The test sale and any temporary test user are removed or explicitly retained by the user.

If any database-backed route fails, production promotion stops. The preview deployment remains available for diagnosis.

## 9. Production promotion and rollback

Production deployment is an irreversible external action and requires a visible confirmation immediately before `vercel deploy --prod` or promotion of the preview.

Rollback uses Vercel's previous deployment promotion/rollback mechanism. Database migrations are forward-only after operational data exists; application rollback therefore requires migrations to remain backward-compatible. Destructive schema changes are excluded from this first release.

After promotion:

- Verify `/`, `/api/health`, login, product reads, and one controlled sale flow.
- Inspect recent Vercel error logs.
- Record the deployment URL and commit/revision.
- Keep the prior deployment available for rollback.

## 10. Security boundaries

- All database access remains server-side.
- `DATABASE_URL`, `DIRECT_URL`, and `SUGI_SESSION_SECRET` are Vercel secrets, never `NEXT_PUBLIC_*` values.
- The `sugi` schema is not exposed through Supabase's Data API.
- Runtime uses a least-privileged application role; migration credentials are administrative and used only from an explicit operator step.
- Errors returned by health and application endpoints remain generic.
- State-changing routes retain authentication, authorization, CSRF, and rate-limit controls.

## 11. Acceptance criteria

- The complete schema can be created from committed migrations in a clean disposable database.
- A second migration deployment is a no-op.
- Prisma validation, generation, TypeScript, all tests, and production build pass.
- Vercel build performs no schema or data mutation.
- Preview `/api/health` confirms the Vercel-to-Supabase runtime path.
- Critical authenticated product and sales flows pass on preview.
- No secret appears in source, build output, runtime logs, or client bundles.
- Production is not promoted without explicit user approval.

## 12. External references

- Vercel CLI deployment workflow: https://vercel.com/docs/projects/deploy-from-cli
- Vercel environment variables: https://vercel.com/docs/environment-variables
- Vercel database connection pooling: https://vercel.com/kb/guide/connection-pooling-with-functions
- Supabase PostgreSQL connection modes: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase Prisma guide: https://supabase.com/docs/guides/database/prisma
