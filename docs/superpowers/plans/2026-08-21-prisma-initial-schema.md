# Prisma Initial Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define every existing Sugi PostgreSQL table in Prisma and create one reviewed, schema-only initial migration that preserves required PostgreSQL behavior.

**Architecture:** Prisma models describe ordinary columns, relations, and portable indexes in the dedicated `sugi` schema. One immutable migration supplements generated DDL with PostgreSQL-specific extension, generated-column, partial-index, GIN/trigram, check-constraint, and `UNLOGGED` SQL. Existing application repositories continue to use the same tables during this phase; only `/api/health` requires Prisma at runtime.

**Tech Stack:** Prisma ORM 7.9.1, `@prisma/adapter-pg`, PostgreSQL 16, TypeScript 5.9, Vitest 4

**Spec:** `docs/superpowers/specs/2026-08-21-vercel-supabase-deployment-design.md`

## Global Constraints

- Never run `prisma db push` or `prisma migrate reset` against Supabase.
- Do not connect this phase to Supabase; migration rehearsal uses a disposable local PostgreSQL database.
- The migration is schema-only: no default user, product import, category rewrite, sale merge, or PIN output.
- Keep `DATABASE_URL`, `DIRECT_URL`, and `SUGI_SESSION_SECRET` out of source and logs.
- Preserve the uncommitted Prisma foundation and unrelated user changes.
- Keep parameterized raw SQL where Prisma cannot represent the required PostgreSQL behavior.
- Do not edit an initial migration after it has been applied outside disposable rehearsal databases.

---

### Task 1: Core Prisma models

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `tests/prisma-schema-contract.test.ts`

**Interfaces:**
- Consumes: existing table definitions in `scripts/migrate.ts`.
- Produces: generated delegates for `SugiUser`, `SugiSession`, `SugiRateLimit`, `SugiPointCampaign`, `SugiPointCampaignItem`, `SugiActivityLog`, `SugiFeedback`, `Product`, `ProductVariant`, `SalesLog`, and `SaleIdempotencyReceipt`.

- [ ] **Step 1: Write the failing schema contract test**

Create `tests/prisma-schema-contract.test.ts` and assert the exact mapped models and critical native types:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');

describe('Prisma schema contract', () => {
  const models = [
    ['SugiUser', 'sugi_users'],
    ['SugiSession', 'sugi_sessions'],
    ['SugiRateLimit', 'sugi_rate_limits'],
    ['SugiPointCampaign', 'sugi_point_campaigns'],
    ['SugiPointCampaignItem', 'sugi_point_campaign_items'],
    ['SugiActivityLog', 'sugi_activity_logs'],
    ['SugiFeedback', 'sugi_feedback'],
    ['Product', 'products'],
    ['ProductVariant', 'product_variants'],
    ['SalesLog', 'sales_logs'],
    ['SaleIdempotencyReceipt', 'sale_idempotency_receipts'],
  ] as const;

  it.each(models)('maps %s to %s', (model, table) => {
    expect(schema).toMatch(new RegExp(`model ${model} \\{[\\s\\S]*?@@map\\("${table}"\\)[\\s\\S]*?\\}`));
  });

  it('uses PostgreSQL-native date, timestamp, JSON, arrays, and bigint IDs', () => {
    expect(schema).toContain('schemas  = ["sugi"]');
    expect(schema.match(/@@schema\("sugi"\)/g)?.length).toBe(models.length);
    expect(schema).toContain('@db.Timestamptz(6)');
    expect(schema).toContain('@db.Date');
    expect(schema).toContain('details Json');
    expect(schema).toContain('nicknames String[]');
    expect(schema).toContain('id BigInt @id @default(autoincrement())');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/prisma-schema-contract.test.ts`

Expected: FAIL because the models are absent.

- [ ] **Step 3: Add the core models and relations**

Add `schemas = ["sugi"]` to the PostgreSQL datasource, then implement these exact mappings in `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  schemas  = ["sugi"]
}
```

```prisma
model SugiUser {
  id                       BigInt    @id @default(autoincrement())
  username                 String    @unique
  displayName              String    @map("display_name")
  pinHash                  String    @map("pin_hash")
  role                     String    @default("user")
  isActive                 Boolean   @default(true) @map("is_active")
  feedbackPromptSeenAt     DateTime? @db.Timestamptz(6) @map("feedback_prompt_seen_at")
  navigationV9PromptSeenAt DateTime? @db.Timestamptz(6) @map("navigation_v9_prompt_seen_at")
  createdAt                DateTime  @default(now()) @db.Timestamptz(6) @map("created_at")
  updatedAt                DateTime  @default(now()) @db.Timestamptz(6) @map("updated_at")
  sessions                 SugiSession[]
  feedback                 SugiFeedback[]
  products                 Product[]
  sales                    SalesLog[]
  receipts                 SaleIdempotencyReceipt[]
  activitySubjects         SugiActivityLog[] @relation("ActivitySubject")
  activityActors           SugiActivityLog[] @relation("ActivityActor")

  @@map("sugi_users")
  @@schema("sugi")
}

model Product {
  id          BigInt    @id @default(autoincrement())
  productName String    @unique @map("product_name")
  category    String    @default("ヘルスケア")
  pointValue  Int       @default(0) @map("point_value")
  nicknames   String[]  @default([])
  isActive    Boolean   @default(true) @map("is_active")
  userId      BigInt?   @map("user_id")
  sourceUrl   String?   @map("source_url")
  createdAt   DateTime  @default(now()) @db.Timestamptz(6) @map("created_at")
  updatedAt   DateTime  @default(now()) @db.Timestamptz(6) @map("updated_at")
  owner       SugiUser? @relation(fields: [userId], references: [id])
  variants    ProductVariant[]
  sales       SalesLog[]
  campaignItems SugiPointCampaignItem[]

  @@index([userId, category, isActive], map: "idx_products_user_category")
  @@map("products")
  @@schema("sugi")
}

model ProductVariant {
  id              BigInt   @id @default(autoincrement())
  productId       BigInt   @map("product_id")
  variantLabel    String   @map("variant_label")
  displayShortcut String?  @map("display_shortcut")
  unitCount       Int      @default(1) @map("unit_count")
  pointValue      Int      @default(0) @map("point_value")
  nicknames       String[] @default([])
  isActive        Boolean  @default(true) @map("is_active")
  createdAt       DateTime @default(now()) @db.Timestamptz(6) @map("created_at")
  updatedAt       DateTime @default(now()) @db.Timestamptz(6) @map("updated_at")
  product         Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  campaignItems   SugiPointCampaignItem[]

  @@unique([productId, variantLabel])
  @@map("product_variants")
  @@schema("sugi")
}
```

Add the remaining eight core models field-for-field from `scripts/migrate.ts`, using `@map` for every camelCase property, `@@schema("sugi")` on every model, explicit relation names for both activity-log user references, and `onDelete` matching the SQL. Represent `sales_logs.total_points` as `Int @default(dbgenerated()) @map("total_points")`; the exact generated expression belongs in migration SQL.

- [ ] **Step 4: Validate and generate**

Run:

```powershell
$env:DIRECT_URL='postgresql://placeholder:placeholder@127.0.0.1:1/placeholder'
.\node_modules\.bin\prisma.cmd format
.\node_modules\.bin\prisma.cmd validate
.\node_modules\.bin\prisma.cmd generate
```

Expected: all commands exit `0` without connecting to a database.

- [ ] **Step 5: Run the contract test and verify GREEN**

Run: `npm test -- tests/prisma-schema-contract.test.ts`

Expected: PASS.

### Task 2: Enrichment Prisma models

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `tests/prisma-schema-contract.test.ts`
- Reference: `scripts/enrich/001_enrichment.sql`

**Interfaces:**
- Consumes: `Product` from Task 1.
- Produces: `EnrichmentSource`, `EnrichmentJob`, `ProductUniqueFeatureItem`, `ProductUniqueSummary`, and `EnrichmentAudit` delegates and relations.

- [ ] **Step 1: Extend the failing model matrix**

Add these entries to `models`:

```ts
['EnrichmentSource', 'enrichment_sources'],
['EnrichmentJob', 'enrichment_jobs'],
['ProductUniqueFeatureItem', 'product_unique_feature_items'],
['ProductUniqueSummary', 'product_unique_summaries'],
['EnrichmentAudit', 'enrichment_audit'],
```

Add assertions for `sourceIds BigInt[]`, JSON audit details, confidence decimals/native types, and the generated source domain field described by `001_enrichment.sql`.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/prisma-schema-contract.test.ts`

Expected: FAIL for the five missing models.

- [ ] **Step 3: Add enrichment models field-for-field**

Translate every column, nullability rule, relation, unique key, and ordinary index from `scripts/enrich/001_enrichment.sql`. Use this pattern for generated/database-maintained values:

```prisma
model EnrichmentSource {
  id          BigInt    @id @default(autoincrement())
  productId   BigInt    @map("product_id")
  url         String
  domain      String    @default(dbgenerated())
  fetchedAt   DateTime? @db.Timestamptz(6) @map("fetched_at")
  fetchStatus String    @default("pending") @map("fetch_status")
  httpStatus  Int?      @map("http_status")
  rawMarkdown String?   @map("raw_markdown")
  product     Product   @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([productId, url])
  @@index([productId, fetchStatus], map: "idx_enrichment_sources_product")
  @@map("enrichment_sources")
  @@schema("sugi")
}
```

Add `@@schema("sugi")` to all five enrichment models and extend `Product` with the five reverse relations required by the enrichment tables.

- [ ] **Step 4: Format, validate, generate, and test**

Run the three Prisma commands from Task 1 and then:

Run: `npm test -- tests/prisma-schema-contract.test.ts`

Expected: PASS.

### Task 3: Schema-only initial migration

**Files:**
- Create: `prisma/migrations/20260821_initial_sugi_schema/migration.sql`
- Create: `prisma/migrations/migration_lock.toml`
- Create: `tests/prisma-migration-contract.test.ts`
- Reference: `scripts/migrate.ts`
- Reference: `scripts/enrich/001_enrichment.sql`

**Interfaces:**
- Consumes: all Prisma models from Tasks 1 and 2.
- Produces: one forward-only migration capable of creating a clean `sugi` schema.

- [ ] **Step 1: Write the failing migration contract**

Create a source-contract test that requires the migration to contain:

```ts
const requiredSql = [
  'CREATE SCHEMA IF NOT EXISTS "sugi"',
  'CREATE EXTENSION IF NOT EXISTS pg_trgm',
  'CREATE UNLOGGED TABLE "sugi"."sugi_rate_limits"',
  'GENERATED ALWAYS AS (quantity * points_per_item) STORED',
  'uniq_sales_logs_user_idem',
  'uniq_sales_logs_daily_product',
  'idx_products_name_trgm',
  'idx_product_variants_label_trgm',
  'idx_enrichment_jobs_claim',
  'CHECK (request_count >= 0)',
  'CHECK (quantity > 0)',
  'CHECK (points_per_item >= 0)',
];

for (const sql of requiredSql) expect(migration).toContain(sql);
expect(migration).not.toContain('INSERT INTO "sugi"."sugi_users"');
expect(migration).not.toContain('SUGI_DEFAULT_PIN');
expect(migration).not.toContain('UPDATE "sugi"."products" SET category');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/prisma-migration-contract.test.ts`

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Generate baseline DDL without applying it**

Run:

```powershell
$env:DIRECT_URL='postgresql://placeholder:placeholder@127.0.0.1:1/placeholder'
.\node_modules\.bin\prisma.cmd migrate diff --from-empty --to-schema prisma/schema.prisma --script
```

Copy the generated schema DDL into `migration.sql`; do not run `migrate dev`, `migrate deploy`, `db push`, or `migrate reset`.

- [ ] **Step 4: Amend the migration with exact PostgreSQL behavior**

At the top, create `sugi` and set every object name to that schema. Replace the rate-limit table with `CREATE UNLOGGED TABLE`. Add the `sales_logs.total_points` generated expression and the `enrichment_sources.domain` generated expression from `001_enrichment.sql`. Add every check constraint, delete action, partial unique index, GIN/trigram index, descending index, and claim index present in the two authoritative SQL sources.

Do not copy these data mutations from `scripts/migrate.ts`:

```sql
INSERT INTO sugi_users ...;
UPDATE products SET category = ...;
INSERT INTO sale_idempotency_receipts SELECT ...;
UPDATE sales_logs ...;
DELETE FROM sales_logs ...;
UPDATE product_variants SET display_shortcut = ...;
```

- [ ] **Step 5: Add the PostgreSQL migration lock**

Create `prisma/migrations/migration_lock.toml`:

```toml
provider = "postgresql"
```

- [ ] **Step 6: Run contract tests**

Run: `npm test -- tests/prisma-schema-contract.test.ts tests/prisma-migration-contract.test.ts`

Expected: PASS.

### Task 4: Disposable PostgreSQL rehearsal and structural verification

**Files:**
- Create: `docker-compose.prisma-test.yml`
- Create: `scripts/verify-prisma-schema.ts`
- Create: `tests/prisma-schema-verifier.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the initial migration from Task 3.
- Produces: `npm run verify:prisma-schema`, a read-only structural verifier, and a disposable PostgreSQL service named `prisma-test-db`.

- [ ] **Step 1: Write failing verifier tests**

Test exported pure functions:

```ts
import { describe, expect, it } from 'vitest';
import { expectedSchemaObjects, summarizeSchemaVerification } from '@/scripts/verify-prisma-schema';

describe('Prisma schema verifier', () => {
  it('requires every core and enrichment table', () => {
    expect(expectedSchemaObjects.tables).toContain('sales_logs');
    expect(expectedSchemaObjects.tables).toContain('enrichment_audit');
    expect(expectedSchemaObjects.indexes).toContain('uniq_sales_logs_daily_product');
  });

  it('reports missing objects without exposing connection details', () => {
    expect(summarizeSchemaVerification({ tables: [], indexes: [], extensions: [] }))
      .toEqual({ ok: false, missingTables: expectedSchemaObjects.tables, missingIndexes: expectedSchemaObjects.indexes, missingExtensions: ['pg_trgm'] });
  });
});
```

- [ ] **Step 2: Run the verifier test and verify RED**

Run: `npm test -- tests/prisma-schema-verifier.test.ts`

Expected: FAIL because the verifier is absent.

- [ ] **Step 3: Add disposable PostgreSQL Compose configuration**

Create a service using `postgres:16-alpine`, container port `5432`, host binding `127.0.0.1:55432`, database `sugi_prisma_test`, user `sugi_test`, password `sugi_test`, and a named volume unique to this Compose file. Do not reuse `sugi-postgres-data`.

- [ ] **Step 4: Implement the read-only verifier**

Query `information_schema.tables`, `pg_indexes`, and `pg_extension` through a one-connection `pg.Pool`. Export `expectedSchemaObjects` and `summarizeSchemaVerification`. When invoked as a script, print only counts and missing object names; never print `DIRECT_URL`.

Add scripts:

```json
{
  "verify:prisma-schema": "tsx scripts/verify-prisma-schema.ts"
}
```

- [ ] **Step 5: Rehearse from an empty disposable database**

Run:

```powershell
docker compose -f docker-compose.prisma-test.yml up -d
$env:DIRECT_URL='postgresql://sugi_test:sugi_test@127.0.0.1:55432/sugi_prisma_test?schema=sugi'
.\node_modules\.bin\prisma.cmd migrate deploy
npm run verify:prisma-schema
.\node_modules\.bin\prisma.cmd migrate deploy
```

Expected: first deploy applies one migration; verifier reports `ok`; second deploy reports no pending migrations.

- [ ] **Step 6: Verify no seed data exists**

Run a read-only count query and require zero rows in `sugi.sugi_users`, `sugi.products`, and `sugi.sales_logs`.

- [ ] **Step 7: Stop only the disposable test stack**

Resolve and verify that the Compose project is `docker-compose.prisma-test.yml`, then run:

```powershell
docker compose -f docker-compose.prisma-test.yml down -v
```

This removes only the disposable Prisma rehearsal database and its dedicated volume.

### Task 5: Regression and review checkpoint

**Files:**
- Verify all files from Tasks 1-4.

**Interfaces:**
- Consumes: completed schema and migration.
- Produces: a reviewed migration artifact safe to present for Supabase approval.

- [ ] **Step 1: Run static and generated checks**

Run Prisma validation/generation, `npx tsc --noEmit`, and `git diff --check`.

- [ ] **Step 2: Run the full test suite and production build**

Run: `npm test`

Run with placeholder build URLs: `npm run build`

Expected: all tests and build pass.

- [ ] **Step 3: Review schema parity**

Compare the model/migration table, column, constraint, foreign-key, and index inventory against both `scripts/migrate.ts` and `scripts/enrich/001_enrichment.sql`. Any intentional difference must be recorded in the migration comments.

- [ ] **Step 4: Request database and code review**

Require a database reviewer to inspect destructive behavior, constraints, indexes, generated columns, role/schema assumptions, and migration idempotency. Require a TypeScript reviewer to inspect the verifier and tests. Resolve every Critical and Important finding before continuing.

- [ ] **Step 5: Stop at the Supabase mutation boundary**

Present the migration hash, verified target hostname/database/schema without credentials, table count, and the exact `prisma migrate deploy` command. Do not connect to or mutate Supabase until the user explicitly approves that command.
