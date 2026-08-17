# Prisma and Supabase Migration Design

**Date:** 2026-08-17  
**Status:** Approved in chat; awaiting written-spec review  
**Scope:** Move the server-backed Sugi Sale App from handwritten PostgreSQL access to Prisma ORM backed by a new, empty Supabase PostgreSQL database.

## 1. Context

The application currently has two deliberately separate persistence modes:

- The authenticated application uses PostgreSQL through `pg`, handwritten SQL, repository modules, and `scripts/migrate.ts`.
- `/local` uses browser IndexedDB and does not synchronize with PostgreSQL.

The former DigitalOcean server and its PostgreSQL data were deleted without a database backup. A Home Screen PWA on an iPhone still contains potentially recoverable data for the original origin, `https://herme-agents.tail71ac56.ts.net`, but that recovery is deferred. The new Supabase project is empty.

This migration must not deploy to, rename, or recreate the original Tailscale origin. It must not clear, update, or otherwise touch the iPhone PWA. Recovered PWA data, if exported later, will be treated as a separate import with validation and explicit approval.

## 2. Goals

1. Use Prisma ORM 7 for ordinary server-side reads, writes, relations, and transactions.
2. Use Supabase only as managed PostgreSQL during this migration; do not introduce Supabase Auth, Storage, Realtime, or browser-side database access.
3. Reproduce the current database rules in an auditable initial migration.
4. Preserve required PostgreSQL-specific behavior with reviewed SQL where Prisma's schema language is not sufficient.
5. Move database consumers incrementally so the existing application remains testable throughout the migration.
6. Rebuild the product catalog from repository-controlled source data and create new users explicitly.
7. Establish migration, backup, and restore practices before the new database receives operational data.

## 3. Non-goals

- Recovering or fabricating deleted server data.
- Importing the iPhone PWA data during the Prisma setup.
- Replacing the `/local` IndexedDB implementation.
- Rewriting every PostgreSQL expression as Prisma Client code.
- Adding Supabase Auth or exposing tables directly to frontend code.
- Preserving the unsafe behavior in `scripts/migrate.ts` that creates/reactivates a default account and prints its PIN.

## 4. Chosen approach

Use a compatibility-first, incremental migration.

```text
Next.js route or server component
            |
       domain service
            |
        repository
            |
   Prisma Client singleton
            |
 @prisma/adapter-pg / pg pool
            |
   Supabase PostgreSQL
```

Prisma 7 requires the PostgreSQL driver adapter. `pg` therefore remains a transitive/runtime database driver even after handwritten `Pool` usage is removed. "Use Prisma" means application persistence is expressed through Prisma Client by default, not that PostgreSQL or SQL disappears.

During the transition, the old query helpers and Prisma use the same database. Repositories move one bounded behavior at a time. The old helper is removed only after all consumers have migrated or been documented as intentional raw SQL.

### Alternatives rejected

1. **One-shot rewrite:** fastest on paper, but too risky for sales idempotency, daily upserts, sessions, throttling, and administrative transactions.
2. **Keep only raw `pg`:** avoids migration effort but does not meet the learning and type-safety goal.
3. **Use Supabase JavaScript queries instead of Prisma:** would change authorization and data-access architecture and would not provide the requested Prisma workflow.

## 5. Connection and secret design

The connection types must remain distinct:

| Variable | Consumer | Purpose | Browser-visible |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase browser SDK, if later needed | Supabase HTTP API base URL | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase browser SDK, if later needed | Public API credential governed by RLS | Yes |
| `DATABASE_URL` | Prisma Client and transitional server-side `pg` code | Runtime PostgreSQL connection | No |
| `DIRECT_URL` | Prisma CLI | Migrations, introspection, and administrative schema work | No |

`NEXT_PUBLIC_SUPABASE_URL` must never be passed to `pg` or Prisma because it is an HTTPS API URL, not a PostgreSQL connection string. Database credentials must never use the `NEXT_PUBLIC_` prefix.

For the long-running Docker/Node deployment, `DATABASE_URL` should use the Supabase session pooler when direct IPv6 connectivity is unavailable. `DIRECT_URL` should use the direct database endpoint for Prisma CLI operations when reachable; otherwise use Supabase's documented session-mode alternative. Both connections require TLS.

Prisma CLI configuration lives in `prisma.config.ts` and reads `DIRECT_URL`. The runtime adapter in `lib/prisma.ts` reads `DATABASE_URL`. Both fail fast with a clear variable-name error and never log the connection string.

The checked-in `.env.example` must contain placeholders only. The real `.env` remains ignored. The accidentally deleted `.env.example` is restored rather than replaced by the secret-bearing `.env`.

## 6. Supabase exposure and database roles

The application continues to implement authentication and authorization in its server layer. Browser code must not query application tables with the Supabase publishable key.

Application tables live in a dedicated `sugi` PostgreSQL schema, not the
Data-API-exposed `public` schema. Supabase Data API configuration must not add
`sugi` to its exposed schemas.

Bootstrap uses two credentials:

- `DIRECT_URL` uses the Supabase database owner only for reviewed migrations
  and schema administration.
- `DATABASE_URL` uses a dedicated `sugi_app` login with `CONNECT`, `USAGE` on
  `sugi`, required table DML, and required sequence privileges. It has no
  database/schema creation, role-management, or `BYPASSRLS` privilege.

The `sugi_app` role receives a default `search_path` of `sugi, public` so the
transitional unqualified raw SQL resolves to the same tables. Prisma's runtime
adapter explicitly selects the `sugi` schema. Never place the database-owner
password, service-role key, or either database URL in client code.

Role creation and grants are infrastructure setup, not part of ordinary
application migrations. They are documented and performed explicitly so a
migration cannot silently widen runtime privileges.

## 7. Prisma project structure

The target files are:

```text
prisma.config.ts
prisma/
  schema.prisma
  migrations/
    20260817_initial_sugi_schema/
      migration.sql
  seed.ts                         # catalog only; explicit invocation
generated/prisma/                 # generated and gitignored or build-generated
lib/prisma.ts                     # singleton Prisma Client + adapter
```

The Prisma schema uses:

- `@@map("snake_case_table")` for existing table names.
- `@map("snake_case_column")` for existing column names.
- `BigInt` for `BIGSERIAL` and `BIGINT` identifiers.
- `DateTime @db.Timestamptz` and `DateTime @db.Date` for timestamp/date columns.
- `Json` for JSONB fields.
- Scalar lists for PostgreSQL arrays.
- Explicit relation names where multiple columns reference `sugi_users`.

Repository mapping functions preserve existing API contracts:

- Convert Prisma `bigint` values to numbers only after checking `Number.isSafeInteger`.
- Convert PostgreSQL dates back to `YYYY-MM-DD` strings at the repository boundary.
- Convert timestamps to the existing ISO/text shapes expected by callers.
- Never pass a raw Prisma object containing `bigint` directly to `Response.json`.

Prisma 7's ESM requirements must be handled deliberately. Existing CommonJS `.js` maintenance scripts that use `require()` are converted to ESM or renamed to `.cjs` before setting package-wide ESM behavior. This work is limited to compatibility; the scripts' database behavior is not redesigned at the same time.

## 8. Schema coverage

The initial migration covers all currently declared application and enrichment tables:

### Core application

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

### Product enrichment

- `enrichment_sources`
- `enrichment_jobs`
- `product_unique_feature_items`
- `product_unique_summaries`
- `enrichment_audit`

The migration is schema-only. It does not create a default user, import products, rewrite categories, merge sales, or print credentials.

## 9. PostgreSQL-specific migration SQL

The initial Prisma migration is reviewed and amended before it runs. Custom SQL preserves behavior that is not fully represented by Prisma models:

- `CREATE EXTENSION IF NOT EXISTS pg_trgm`.
- `UNLOGGED` behavior for `sugi_rate_limits`.
- Check constraints for roles, statuses, positive quantities, point values, message lengths, and confidence ranges.
- Generated columns such as `sales_logs.total_points` and `enrichment_sources.domain`.
- Partial unique indexes for sale idempotency, one daily sale row, enrichment feature uniqueness, active sessions, and claimable jobs.
- GIN and trigram indexes used by product search.
- Array defaults and JSONB defaults.
- Required `ON DELETE CASCADE`, `ON DELETE SET NULL`, and nullable-reference behavior.

Custom SQL in a migration is immutable after deployment. Future changes use new forward migrations rather than editing an applied migration.

## 10. Migration and initialization workflow

### 10.1 Local rehearsal

1. Start a fresh local PostgreSQL database with no reused volume or data.
2. Run `prisma validate` and `prisma generate`.
3. Apply the initial migration with `prisma migrate deploy`.
4. Verify tables, extensions, constraints, generated columns, indexes, and foreign keys with database queries.
5. Run the application tests and a health smoke test.
6. Destroy only the disposable test database after its target is explicitly verified.

`prisma migrate dev` may be used only against disposable local development data. If any Prisma command proposes resetting Supabase, stop.

### 10.2 Supabase initialization

1. Confirm the project is still empty.
2. Apply the already-reviewed migration with `prisma migrate deploy` through `DIRECT_URL`.
3. Verify migration history and schema objects.
4. Run a Prisma `SELECT 1`/health query through `DATABASE_URL`.
5. Import the repository-controlled product catalog with an explicit seed command.
6. Compare expected and actual product/variant counts and record the result.
7. Create the first administrator through an explicit secure command that accepts input without logging the PIN.
8. Exercise login, product read, one test sale, idempotent replay, edit/delete, and cleanup of the clearly identified test record.

Production initialization never runs automatically as part of `npm start`.

## 11. Repository migration order

Each phase changes one behavior, adds or updates tests, and verifies the database result before the next phase.

1. **Prisma connection and health** — add the singleton and migrate `/api/health`.
2. **Read-only product/catalog queries** — categories, search, product families, and variants.
3. **Users and sessions** — authentication lookup, session creation/revocation, and device metadata transaction.
4. **Simple user-scoped writes** — navigation notices, feedback, and activity records.
5. **Sales reads** — today, date, month, latest, and status queries with stable date/ID mapping.
6. **Sales writes** — daily aggregation, idempotency receipts, edits, deletes, and rate-budget refund behavior.
7. **Administration and campaigns** — product/variant management, next-month campaigns, application, and point synchronization.
8. **Rate limiting** — keep atomic SQL through a narrow Prisma raw-query module unless an equivalent transaction is proven under concurrency.
9. **Enrichment scripts/workers** — migrate after the interactive application is stable.
10. **Remove legacy helper** — delete `lib/db.ts` and `infrastructure/postgres/client.ts` only when no unintended consumer remains.

The product trigram search and specialized atomic statements may remain parameterized `Prisma.sql`, `$queryRaw`, or `$executeRaw`. Raw operations must be centralized, parameterized, tested, and documented; unsafe string interpolation is forbidden.

## 12. Product and user initialization

The repository's `data/local-product-catalog.json` and existing import scripts are the only accepted product reconstruction sources. The seed process must be:

- Idempotent.
- Transactional per logical batch.
- Explicitly invoked.
- Counted and summarized without dumping product/customer secrets.
- Safe to rerun without duplicating products or variants.

Deleted users and sales are not recreated from guesses. The first administrator is new. Password/PIN hashing remains bcrypt-based unless a separate authentication design is approved.

## 13. Tests and acceptance criteria

### Static and generated checks

- `prisma validate` succeeds.
- `prisma generate` succeeds in development and Docker builds.
- TypeScript and Next.js builds succeed.
- No generated client or database secret is accidentally committed.

### Migration checks

- A clean local database reaches the expected schema from migration files alone.
- A second `prisma migrate deploy` is a no-op.
- All expected tables, foreign keys, check constraints, generated columns, and specialized indexes exist.
- No migration creates or promotes a user or logs a PIN.

### Behavioral checks

- `/api/health` reports database connectivity through Prisma.
- Login/session revocation behavior remains unchanged.
- Product search results and ordering remain compatible.
- Sale creation is idempotent for `(user_id, idempotency_key)`.
- Repeated same-day sales preserve the intended points policy.
- Concurrent rate-limit reservations do not exceed the configured budget.
- Date handling uses the Tokyo business date as before.
- Existing unit/source-contract tests pass, supplemented by real PostgreSQL integration tests for critical transactions.

### Security checks

- `DATABASE_URL` and `DIRECT_URL` are server-only and absent from client bundles/logs.
- Anonymous Supabase Data API requests cannot read or write application tables.
- Raw SQL uses parameters or Prisma SQL templates.
- Runtime database permissions are no broader than documented.

## 14. Deployment and operations

Docker and production startup change from ad hoc schema mutation to immutable migrations:

```text
release step: prisma migrate deploy
runtime step: next start
```

Migrations must complete successfully before the new application version receives traffic. Seeding and administrator creation remain separate operator actions.

Before operational use, configure a database backup independent of the application host. At minimum:

- Scheduled logical PostgreSQL backups.
- Encrypted storage outside the runtime machine.
- Retention policy.
- Automated success/failure reporting.
- Periodic restore verification into an isolated database.

The existing systemd backup/restore assets are reviewed and adapted to Supabase rather than assumed compatible.

## 15. Rollback and failure handling

- Before user data exists, a failed initial migration is fixed in a disposable local database, then the empty Supabase project is reinitialized only with explicit confirmation.
- After operational data exists, migrations are forward-only. Never edit an applied migration.
- Application phases can temporarily fall back to the existing `pg` repository because both paths use the same schema, but only after tests confirm schema compatibility.
- A failed seed transaction rolls back its current batch and reports counts; it does not reset the database.
- A failed PWA recovery import, if attempted later, is isolated from the production tables until validated.

## 16. Documentation and learning deliverables

Implementation includes short documentation explaining:

- How Prisma models map to the real PostgreSQL tables.
- When Prisma Client is appropriate and when custom SQL remains necessary.
- The difference between public Supabase API variables and private PostgreSQL URLs.
- How to create, review, apply, and verify a migration.
- How to rehearse backup restoration.

Commands are shown to the user before any destructive or production-changing step. Supabase migration, catalog import, administrator creation, Tailscale changes, and deployment remain explicit approval boundaries.
