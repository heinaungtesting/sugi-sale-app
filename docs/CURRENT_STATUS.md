# Sugi Sale App — Current Status and Complete Feature Inventory

**Status date:** 2026-07-23 (Japan Standard Time)
**Repository:** `/home/hermes/sugi-sale-app`
**Canonical private URL:** `https://herme-agents.tail71ac56.ts.net`
**Audience:** Project owner, operators, maintainers, and future developers

---

## 1. Executive Summary

Sugi Sale App is a mobile-first, multi-user sales-point logger designed for fast use at a pharmacy counter. Its primary workflow is deliberately short:

1. Sign in with an assigned ID and PIN.
2. Search by product name, alias, family name, or variant.
3. Tap the correct variant once.
4. The sale appears immediately in today's records while the write synchronizes in the background.

The app currently operates as a **private internal production system over Tailscale**, not as a public internet service. It includes an authenticated server-backed mode and a separate local-only PWA mode. The server-backed mode provides shared product data, per-user sales history, administration, feedback, monthly point campaigns, audit activity, and PostgreSQL persistence. The local-only mode stores everything in the device's IndexedDB and sends no sales data to the server.

### Current health snapshot

| Area | Current status |
|---|---|
| Canonical HTTPS health | `ok`; database `ok` |
| Main service | Active and enabled |
| Port 8080 service | Active and enabled |
| Test suite | **231/231 tests passed** across 50 files |
| Production build | Passed with Next.js 16.2.9 |
| Active products | **258** |
| Active product variants | **870** |
| Active users | **12** |
| Recorded sales rows | **247** |
| Latest backup checksum | Verified successfully |
| Daily backup timer | Active |
| Weekly restore-verification timer | Active |

### Current maturity assessment

- **Private/Tailscale internal production:** Operational.
- **Small colleague pilot:** Supported.
- **Public internet production:** Not yet recommended without stronger edge controls, monitoring, operational cleanup, and a clean release.
- **Source control condition:** `v1.2.0` established the reproducible baseline; `v1.3.1` adds modular boundaries, IndexedDB queue persistence, observability, active-device management, and a PWA cache rollover.

---

## 2. Product Purpose and Design Principles

### Primary purpose

The app records point-product sales quickly enough to use during an actual shift without slowing down customer service.

### Design principles

- **Counter speed first:** Search and tap are the main actions.
- **Japanese-first interface:** Main operational copy defaults to Japanese.
- **English optional:** The Home interface includes a Japanese/English toggle.
- **Product families instead of duplicate cards:** Related sizes and formulations appear as variant buttons under one practical family card when appropriate.
- **Visible decision data:** Product and variant buttons show current points before logging.
- **Silent successful logging:** A normal successful tap does not interrupt the user with a verbose confirmation flow.
- **Resilient under bad Wi-Fi:** Taps are stored locally first and synchronized in the background.
- **Historical integrity:** Each sale snapshots the point value used at the time; later point changes do not rewrite unrelated historical sales.
- **Per-user ownership:** Sales totals and histories are scoped to the signed-in user.
- **Privacy by design:** The app is not intended to store customer personal, medical, payment, or membership information.
- **Cute but functional visual system:** Dog and cat artwork softens the UI without replacing or obstructing the fast logging workflow.

---

## 3. User-Facing Features

### 3.1 Authentication and session handling

- Login using a pre-created username and PIN.
- Case-insensitive username handling.
- Mobile-friendly username input behavior.
- PINs stored as bcrypt hashes, not plaintext.
- Signed session cookies.
- Database-backed sessions using unique session IDs (`jti`).
- Active-device list with last-used time and device/browser description.
- Individual session revocation and “revoke all other devices.”
- Automatic expired-session deletion, PIN-change revocation, and a ten-session cap.
- Logout revokes the active server-side session before deleting the browser cookie.
- Inactive users cannot continue using the system.
- Separate `user` and `admin` roles.
- Login throttling: up to 10 failed attempts in a 10-minute in-memory window per resolved client/user key.
- A successful login also issues a signed CSRF token cookie.

### 3.2 Home screen

The Home screen is the primary shift interface.

### Header and navigation

- Clearly highlighted active user's display name.
- Today's item count.
- Today's point total.
- Connectivity/synchronization status pill.
- Japanese/English language toggle.
- Logout action.
- Bottom navigation:
  - Home
  - History/calendar
  - All records
  - Feedback
  - Admin, visible only to administrators

### Product search

- Large search-first input.
- Search by:
  - Exact product name
  - Partial product name
  - Product alias or nickname
  - Variant label
  - Variant alias
  - Combined family and variant text
  - Shortcut terms such as `hibi`, `kuchi`, `fetas`, and `pripink`
- Unicode NFKC normalization.
- Full-width/half-width compatibility.
- Japanese whitespace normalization.
- Product-family grouping.
- Duplicate-looking records are consolidated at presentation time.
- Current positive-point representation is prioritized over an equivalent zero-point duplicate.
- Search ranking incorporates name relevance, aliases, variants, sales frequency, and point usefulness.
- Up to 20 family cards are shown for a search.
- Server search is used for typed queries rather than relying only on the initially loaded catalog.

### Mostly-used products

- Up to 30 frequently useful product families are shown when the search field is empty.
- Every family presents direct variant buttons.
- Variant buttons show the current point value.

### One-tap logging

- One tap records quantity `1` for the exact selected product or variant.
- A 250 ms same-button debounce protects against accidental duplicate touch events.
- Logging is optimistic: the UI updates immediately without waiting for the network.
- The network operation runs through the persistent offline-aware queue.

### Zero-point product handling

- Zero-point products remain visible as `点数未設定` / `Points not set`.
- Tapping a zero-point item opens `記録前に点数を設定`.
- The user must enter a value from 1 to 9999.
- `保存して記録` saves the point value and logs exactly one sale.
- The server remains the final guard against raw zero-point sales.

### Point editing

- Long-press a product or variant to update its current point value.
- A recent sale row contains an inline point correction field.
- Correcting the latest sale updates:
  - That sale's captured point value
  - The corresponding current product/variant value for future logs
- Product/variant synchronization handles equivalent flat and family-variant representations.
- Historical unrelated sales are not retroactively modified.

### Quick-add missing products

When search returns no family:

- The searched name is prefilled.
- The user enters a positive point value.
- `追加して記録` creates the product and immediately logs one sale.
- The newly created product is searchable immediately afterward.

### Recent-today correction controls

The latest eight displayed rows support:

- Quantity decrease
- Quantity increase
- Undo/delete
- Point correction
- Queue status display
- Manual retry after synchronization failure
- Dismissal of failed unsent queue entries

Repeated sales for the same displayed item are coalesced into a practical recent-row representation.

### 3.3 History/calendar screen

- Japanese monthly calendar.
- Previous-month and next-month navigation.
- Activity dots on dates containing records.
- Selected-date detail card.
- Previous day, today, and next day controls.
- Selected-day item and point totals.
- Add products directly to the selected date.
- Search uses the same family/variant model as Home.
- Results are paginated in groups of 12 families with `もっと見る`.
- Selected-date records support:
  - Quantity decrease
  - Quantity increase
  - Deletion
- Optimistic queue entries appear while synchronization is pending.
- Dates use the Asia/Tokyo business date model.

### 3.4 All Records screen

The `/logs` page is a read-oriented monthly logbook.

- Displays only the current Tokyo month.
- Groups records by date.
- Shows current-month total items and points in the header.
- Shows monthly category totals.
- Shows daily category totals.
- Shows product name, quantity, per-item points, and row total.
- Modification is intentionally redirected to Home or History.
- Product reporting categories are normalized to:
  - `ヘルスケア`
  - `化粧品`

### 3.5 Feedback system

### User feedback

- Dedicated Japanese feedback page.
- Categories such as improvement requests and related feedback classifications.
- Writing guide covering screen, situation, and desired improvement.
- Explicit warning not to enter customer personal or medical information.
- Message validation from 10 to 1000 characters.
- Character counter.
- User can view their ten most recent submissions and statuses.
- One-time DB-backed welcome/prompt state survives across devices.

### Admin feedback review

- Administrators can open `/admin/feedback`.
- Feedback can be reviewed with user attribution and status.
- Feedback data currently contains 2 submitted rows.

### 3.6 Legal and privacy page

The Japanese `/legal` page states:

- The app is an independently operated work-support tool and is not an official Sugi Pharmacy service.
- Customer names, addresses, phone numbers, emails, member numbers, payment information, medical history, symptoms, and consultation details must not be stored.
- Operational user, product, variant, point, and sales-log data are stored only to provide app functions.
- Sales logs are not intended for routine owner surveillance.
- Data is not used for advertising, marketing sale, or unrelated third-party provision.
- Users are responsible for their account and correcting inaccurate records.
- The app is not an official payroll, evaluation, audit, or company record system.

The legal page's displayed last-updated date is 2026-06-15.

---

## 4. Local-Only PWA Mode

The route `/local` is a separate privacy-first operating mode.

### Local-only behavior

- No server login is required.
- The user creates a device-local display name.
- Profile, sales, and custom products are stored in IndexedDB.
- Sales data is not sent to the PostgreSQL server.
- The app requests persistent browser storage when available.
- A bundled product catalog is available offline.
- Search and product-family grouping work locally.
- Product buttons show points.
- Local sales support quantity changes and deletion.
- Local history shows all device records.
- Users can add, edit, and remove custom local products.
- JSON backup export.
- Validated JSON backup restore.
- Full device-data reset with confirmation.

### PWA support

- Manifest name: `Sugi Sale Logger`
- Short name: `SugiLog`
- Manifest start URL: `/local`
- Standalone display mode.
- Japanese language and portrait orientation.
- 192×192 and 512×512 maskable icons.
- Apple touch icon and 16/32 px favicons.
- Service worker app-shell caching.
- Dedicated offline page.

### Local-only limitation

If browser/site data is cleared, local-only records are lost unless the user exported a backup. Browsers that deny persistent storage may also evict data under storage pressure.

---

## 5. Administration Features

The `/admin` workspace is restricted to the `admin` role.

### 5.1 Product management

- Search by product name or alias.
- Select and edit an existing product.
- Edit:
  - Product name
  - Category
  - Fallback point value
  - Aliases
  - Active status
- Add a new product.
- Delete/deactivate a product safely:
  - Hard-delete only where history permits
  - Preserve history by deactivating referenced records
- View and manage variants for the selected product.
- Add or edit variant:
  - Label
  - Display shortcut
  - Unit count
  - Point value
  - Aliases
  - Active status
- Delete/deactivate variants using history-aware semantics.

### 5.2 JSON product import

- Admin-only JSON import panel.
- Accepts product names from common input keys such as `product_name`, `name_ja`, or `name`.
- Upserts products by normalized name.
- Upserts variants by normalized family and variant label.
- Merges aliases.
- Supports categories, points, shortcuts, unit counts, and active state.
- Avoids blindly creating normalized duplicates.

### 5.3 Bulk monthly point updates

- Accepts one update per line or comma-separated input.
- Supports forms such as:
  - `alias 120`
  - `name=120`
  - Product shortcuts
  - Variant shortcuts
- Resolves variants before fallback products where appropriate.
- Updates future point values only.
- Historical `sales_logs.points_per_item` values remain snapshots.
- Point changes are written to the admin activity feed.

### 5.4 Next-month campaign staging

- JSON campaigns can be staged for the next Tokyo month rather than applied immediately.
- Current points remain unchanged during staging.
- Staging stores canonical product/variant targets, aliases, source payload, and target point values.
- At the due month:
  - Active points can be reset according to campaign semantics.
  - Staged values are applied.
  - Campaign status and applied timestamp are updated.
- Current database state:
  - 1 campaign
  - 333 campaign items

### 5.5 Staff account administration

- Create staff accounts.
- Update display name.
- Change PIN.
- Change role between `user` and `admin`.
- Activate/deactivate accounts.
- Delete history-free accounts.
- Deactivate history-bearing accounts while preserving sales history.
- Prevent an administrator from deleting their own active account.
- Revoke sessions when deleting/deactivating as required.
- Current state: 12 users, all 12 active.

### 5.6 Admin activity feed

- Filterable by user.
- Combines historical operational information with explicit audit events.
- Includes examples such as:
  - Product creation and point updates
  - Variant updates
  - Bulk point updates
  - User point corrections
  - Login/logout/session activity where represented
- Current explicit activity-log row count: 40.

---

## 6. Catalog and Search Status

### 6.1 Current database inventory

| Metric | Count |
|---|---:|
| Active products | 258 |
| Inactive products | 77 |
| Active variants | 870 |
| Inactive variants | 10 |
| Active product aliases | 928 |
| Active variant aliases | 2,111 |
| Active base products currently at 0 points | 232 |
| Active variants currently at 0 points | 498 |

A high zero-point count is expected outside an active monthly point campaign. These items remain discoverable and require point assignment before sale logging.

### 6.2 Family and duplicate strategy

- A product family is the main card.
- Sizes, packaging, mild/cool versions, and related sellable forms become explicit variant buttons where clinically and operationally appropriate.
- Distinct formulations remain separate variants or families rather than being deleted merely because names are similar.
- Duplicate candidates are normalized using Unicode, Japanese/full-width whitespace, aliases, and fuzzy similarity.
- Positive-point current records are preferred when duplicate representations compete.
- Legacy names are retained as aliases so old search terms continue to work.
- Sales-bearing legacy rows are deactivated instead of deleted.
- Zero-history duplicates may be hard-deleted after backup and metadata migration.

### 6.3 Current special family structure

The current catalog includes intentional consolidated structures such as:

- `サンテメディカルプラス`
  - `12` — 100pt
  - `アクティブ` — 100pt
  - `ガードEX` — 100pt
- `フェイタス` families and explicit size/form variants
- `バンテリン` divided into practical body/supporter family groups rather than one unusably large card
- ELIXIR lines grouped by product line with W/E and related variants
- Product families for dosage-form pairs such as liquid/tablet where appropriate

### 6.4 Search verification evidence

The latest saved representative live audit at `backups/manual-imports/2026-07-22-091635-live-search-verify/search_test.json` reported:

- 5/5 expected representative families found
- 100% representative coverage
- No API/database mismatch
- Live API latency between 52 ms and 72 ms for the tested searches
- Successful examples:
  - `ザ・ガードコーワ 整腸錠 α³+`
  - `ひざ S`
  - `日本蜂寿 粒`
  - `エリクシールアドバンスW TⅡ 本体`
  - `サンテメディカルプラス ガードEX`

This saved artifact is a representative regression audit, not a newly executed exhaustive proof of all 1,128 active product/variant rows.

---

## 7. Slow-Network and Offline Resilience

The server-backed logger is designed so a product tap does not wait for the network.

### Client queue

- Module: `lib/sale-queue.ts`
- Primary persistence: IndexedDB database `sugi-sale-queue`; legacy localStorage key `sugi-sale-queue-v1` is migrated automatically.
- Each tap receives a stable idempotency key.
- Original tap timestamp is preserved as the Tokyo sale date, including retries after midnight.
- Maximum queue size: 200.
- Two writes may be processed concurrently.
- Per-request timeout: 10 seconds.
- Retry sequence: immediately, 1.5 seconds, 4 seconds, and 9 seconds.
- Maximum automatic attempts: 4.
- Network and retryable server failures remain recoverable.
- Permanent client errors avoid pointless rapid retries.
- A five-second stale-drain recovery loop handles missed browser online events and recoverable CSRF/session timing conditions.
- A 30-second health probe checks `/api/health`.
- `navigator.onLine`, online/offline browser events, and health state drive the connectivity indicator.
- BroadcastChannel synchronizes queue status across tabs.
- Mid-flight entries return to pending after a tab/browser restart.
- Failed entries can be retried manually.

### Server idempotency

- `sales_logs.idempotency_key` stores the client key.
- A partial unique index on `(user_id, idempotency_key)` prevents duplicate inserts.
- Replaying the same key returns the original canonical sale.
- Duplicate replays do not consume the new-sale write-rate budget.
- Mismatched replay payloads do not mutate the first accepted sale.

### Remaining queue limitation

If IndexedDB is unavailable, the queue falls back to localStorage. Memory is used only when both durable stores are blocked; unsynchronized memory-only taps can be lost if the tab closes.

---

## 8. Security and Data-Integrity Controls

### 8.1 Implemented controls

- Production fails fast if `SUGI_SESSION_SECRET` is missing.
- Password-equivalent PINs are bcrypt-hashed.
- Signed session token.
- HttpOnly session cookie.
- Configurable Secure cookie behavior for HTTPS vs private HTTP deployment.
- Database-backed session revocation.
- Role-based admin authorization.
- Tokenless mutation-origin guard:
  - Same-origin Origin/Referer validation
  - Proxy-aware allowlisted host validation
  - No CSRF cookie, HMAC token, custom CSRF header, refresh, or replay path
- Sales and history ownership checks.
- Positive point-value validation.
- Quantity and request validation.
- Idempotent sale inserts.
- Sale-write rate limiting before database allocation, with refund behavior for non-persisted requests.
- History-preserving delete/deactivate semantics.
- Admin activity logging.
- No session token returned as a reusable login JSON credential.
- Health endpoint confirms database connectivity.

### 8.2 Security boundary

The intended trust boundary is a small set of known staff devices on the private Tailscale network. This is materially safer than public exposure but does not remove the need for account hygiene and secure device handling.

### 8.3 Known security/operational limitations

- Login throttling is in-memory and not shared across replicas or restarts.
- There is no Redis or edge-backed distributed rate limiter.
- No formal centralized monitoring/alerting platform is documented.
- No public-facing WAF or hardened public ingress is documented.
- A private device with a valid session can access its user's operational history.
- Current working-tree changes are not captured in a clean signed/tagged release.
- The production runbook contains some outdated warnings and URL guidance; see Section 13.

---

## 9. Data Model

### 9.1 Core tables

### `sugi_users`

Stores username, display name, bcrypt PIN hash, role, active status, timestamps, and DB-backed one-time prompt state.

### `sugi_sessions`

Stores session `jti`, user, expiry, creation time, and revocation time.

### `products`

Stores the product family/base record:

- Name
- Category
- Current fallback point value
- Aliases
- Optional RAG document path/source URL
- Active state
- Optional owner user ID for future private products
- Timestamps

### `product_variants`

Stores exact sellable options:

- Parent product
- Variant label
- Display shortcut
- Unit count
- Current point value
- Aliases
- Active state
- Timestamps

### `sales_logs`

Stores immutable historical facts plus controlled corrections:

- Tokyo sale date
- Product reference
- Display product name snapshot
- Quantity
- Points per item snapshot
- Generated total points
- Notes
- User ownership
- Idempotency key
- Creation timestamp

### `sugi_feedback`

Stores user feedback category, message, status, and creation time.

### `sugi_activity_logs`

Stores subject user, actor, action name, human-readable summary, JSON details, and timestamp.

### `sugi_point_campaigns` and `sugi_point_campaign_items`

Store staged monthly campaign headers and exact product/variant point assignments.

### 9.2 Product-research tables

### `product_unique_features`

Stores source-backed product differentiation:

- Japanese, English, and Chinese feature lists
- Customer pitches
- Japanese dosage/caution notes
- Source URLs
- Confidence
- Model
- Review/status metadata

Current rows: **45**.

### `product_research_sources`

Stores research queries, URLs, titles, provider, source markdown, SHA-256, and retrieval time.

Current rows: **150**.

These research records are deliberately separate from the transactional product catalog.

---

## 10. Application Architecture

### 10.1 Technology stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.9, App Router, Turbopack build |
| UI | React 19.2.1 / React DOM 19.2.1 |
| Language | TypeScript 5.9.3 |
| Database | PostgreSQL via `pg` 8.16.3 |
| Authentication hashing | bcryptjs 3.0.3 |
| Testing | Vitest 4.1.8 |
| Runtime | Node.js 22.22.3 |
| Service management | User-level systemd |
| Private networking | Tailscale / MagicDNS HTTPS origin |
| Local-only storage | IndexedDB |
| Queue persistence | localStorage + BroadcastChannel |

### 10.2 Source footprint

Excluding `node_modules` and `.next`:

- 101 `.ts` files, approximately 7,914 lines
- 27 `.tsx` files, approximately 3,186 lines
- 48 test files, approximately 3,175 lines

The counts overlap because test files are TypeScript; they are presented as codebase-shape indicators rather than a strict total-line calculation.

### 10.3 Main routes

### Pages

| Route | Purpose |
|---|---|
| `/` | Authenticated Home search and one-tap logging |
| `/login` | ID/PIN sign-in |
| `/sales` | Calendar and selected-date editing |
| `/logs` | Current-month read-only logbook |
| `/feedback` | User feedback submission/history |
| `/admin` | Product, variant, points, users, and activity administration |
| `/admin/feedback` | Administrator feedback review |
| `/local` | Device-only IndexedDB logger/PWA start page |
| `/offline` | Offline fallback |
| `/legal` | Japanese terms and privacy policy |
| `/category/[name]` | Category-specific product view |

### APIs

- Authentication: login, logout, current user, CSRF token
- Products: search, quick create, point update
- Sales: create, latest, today, selected date, month, edit/delete by ID
- Categories
- Feedback and prompt state
- Navigation prompt state
- Admin products, variants, users, points, JSON import, activity, feedback, and next-month campaigns
- Database health

---

## 11. Deployment and Operations

### 11.1 Live services

Two user-level systemd services are active and enabled:

- `sugi-sale-app.service`
- `sugi-sale-app-8080.service`

The service environment must include Node 22 paths because the system Node 18 runtime is too old for Next.js 16.

### Known origins

- Canonical HTTPS origin: `https://herme-agents.tail71ac56.ts.net`
- Private direct service: `http://100.111.161.73:3100`
- Private alternate service: `http://100.111.161.73:8080`

The canonical HTTPS route currently fronts the 8080 deployment path.

### 11.2 Current live health

The canonical HTTPS health endpoint returned:

```json
{"ok":true,"database":"ok"}
```

### 11.3 Deployment workflow

Expected production workflow:

```bash
npm ci
npm test
npm run build
systemctl --user restart sugi-sale-app.service sugi-sale-app-8080.service
curl -fsS https://herme-agents.tail71ac56.ts.net/api/health
```

For PWA changes, the service-worker cache version must also be bumped and verified after worker activation.

### 11.4 Docker development environment

The repository supports a local Docker workflow for app and database testing:

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up --build
```

This allows phone/browser testing without installing PostgreSQL locally.

---

## 12. Backup, Restore, and Recovery

### 12.1 Automated backup

- User timer: `sugi-sale-backup.timer`
- Runs daily.
- Default directory: `/home/hermes/backups/sugi-sale-app/`
- Retention policy: 30 days.
- Creates PostgreSQL custom-format dumps plus SHA-256 checksums.
- `latest.dump` points to/copies the latest usable backup artifact.

### Latest observed backup

- Backup: `sugi-sale-app-20260722-084018.dump`
- Size: 748,924 bytes
- Checksum verification: **OK**

### 12.2 Restore verification

- User timer: `sugi-sale-restore-verify.timer`
- Runs weekly.
- Creates a temporary verification database.
- Migrates the temporary schema.
- Restores the backup transactionally.
- Verifies the restored system without destructively testing production.

### 12.3 Manual restore

The restore script requires explicit `RESTORE` confirmation and uses transaction-oriented truncate/reload behavior. Restoration should be used only for corruption or data loss and should be followed by application health and data-integrity checks.

---

## 13. Verification Results

The following verification was executed against the current source tree on 2026-07-22 UTC / 2026-07-23 JST.

### 13.1 Automated tests

```text
Test Files: 50 passed (50)
Tests:      231 passed (231)
```

Coverage areas represented by the suite include:

- Offline queue behavior, recovery, tap dates, and coalescing
- CSRF server and client behavior
- Session token and logout revocation
- Login/security regressions
- Sales API and rate-limit ordering
- Search ranking, aliases, families, and performance contracts
- Monthly campaigns
- Point synchronization and activity logging
- Home, calendar, logs, bottom navigation, language toggle, and layout behavior
- Feedback and navigation prompts
- Local-only model/PWA behavior
- PWA icons and offline install behavior
- Production readiness contracts
- Cute asset coverage
- Docker migration source behavior

### 13.2 Production build

```text
Next.js: 16.2.9
Compilation: passed
TypeScript: passed
Static page generation: 29/29
Build result: passed
```

The build produced 11 page routes and 25 API routes, plus framework error routes.

### 13.3 Runtime checks

- Both Sugi services: active
- Both Sugi services: enabled
- Canonical HTTPS health: healthy
- PostgreSQL health: healthy
- Latest backup checksum: valid

---

## 14. Current Risks, Gaps, and Documentation Drift

These are the main issues preventing a clean “fully production-ready for broad deployment” declaration.

### 14.1 Release reproducibility

The pre-release audit found many modified and untracked files, including core pages, API routes, queue logic, database logic, PWA components, feedback features, local-only mode, operations files, and tests. Release `v1.2.0` consolidates the intended source, removes generated dogfood output and Python bytecode, and adds explicit ignore rules.

The last committed revision is:

```text
d6e29c940848402ece15e4e992c160a072c716d5
2026-07-06 — Add Docker local test setup for Sugi app
```

Current describe output:

```text
sugi-v1.1.0-9-gd6e29c9-dirty
```

**Release control:** `npm run build` now generates `public/build-info.json` from the package version, exact Git commit, and build timestamp. `/api/health` returns those values. Production deployment must check out an immutable tag before building and must verify the returned commit afterward.

**Ongoing rule:** Never deploy a dirty working tree. Every production change must end in a clean commit, immutable tag, build from that tag, and matching live health metadata.

### 14.2 README status

The README was updated for `v1.2.0` to describe visible point values, the authenticated and local-only modes, test/build commands, tagged deployment, and build identity.

**Ongoing rule:** Update README and production documentation in the same commit as user-visible or operational changes.

### 14.3 Production runbook status

`PRODUCTION.md` was updated for `v1.2.0` to reflect signed CSRF protection, the canonical HTTPS MagicDNS origin, tagged deployments, and health build identity.

**Ongoing rule:** Treat the runbook as release-controlled production code.

### 14.4 Version identity

`package.json` and `package-lock.json` are aligned at `1.3.1`. The release tag is `v1.3.1`, and `/api/health` exposes the package version, exact commit, and build timestamp.

**Ongoing rule:** Keep package version, tag, and deployed health metadata aligned.

### 14.5 Exhaustive live catalog proof is not freshly attached

The current representative search audit is healthy, and the automated search suite passes. However, the saved live artifact directly inspected for this document covers five representative families rather than all 258 active products and 870 active variants.

**Required action:** Run and archive a fresh exhaustive product-name, alias, variant-label, and family+variant live coverage report after the release is committed.

### 14.6 Public-internet readiness remains limited

Before public exposure, add or formally verify:

- Edge/reverse-proxy rate limiting
- Centralized logs and alerts
- Availability and backup-failure monitoring
- Security header/CSP review
- Incident-response ownership
- Public TLS/proxy configuration review
- Load and abuse testing
- Formal account offboarding process

### 14.7 Local-only backup responsibility

Local-only users must export backups manually. There is no server-side recovery because the mode intentionally sends no data to the server.

---

## 15. Recommended Next Actions

### Priority 1 — create a reproducible release

1. Review all modified and untracked files.
2. Remove temporary artifacts and generated test output that should not be versioned.
3. Update README and production documentation.
4. Run tests and build again.
5. Commit the complete intended source.
6. Create a new Git tag.
7. Deploy that exact commit.
8. Record the deployed commit in the runbook.

### Priority 2 — exhaustive live verification

1. Test every active product name.
2. Test all active aliases.
3. Test every active variant label and alias.
4. Test family+variant combined queries.
5. Confirm each result maps to one practical Home family card.
6. Compare API rows against database rows.
7. Archive JSON results with date, coverage, latency, and mismatches.

### Priority 3 — operational polish

1. Add alerting for service failure, backup failure, and restore-verification failure.
2. Define account onboarding/offboarding ownership.
3. Add a release changelog.
4. Decide whether `/local` and the authenticated app should remain in one PWA manifest or become explicitly separate install experiences.
5. Review active devices from `/sessions`; expiry cleanup and the ten-session cap now prevent indefinite accumulation.

---

## 16. Practical Release Gate

The next release should not be called complete until all boxes below are checked:

- [x] 231 automated tests pass
- [x] Next.js production build passes
- [x] Both systemd services are active
- [x] Database health is `ok`
- [x] Latest backup checksum verifies
- [x] Daily backup timer exists
- [x] Weekly restore-verification timer exists
- [x] Generated and temporary artifacts removed/ignored
- [x] README matches visible behavior
- [x] Production runbook matches current HTTPS/CSRF architecture
- [x] Health endpoint includes version, commit, and build time
- [ ] Working tree is clean
- [ ] Current features are committed
- [ ] New release tag created
- [ ] Exhaustive live search report archived for the release
- [ ] Exact tagged revision deployed and recorded

---

## 17. Bottom Line

The Sugi Sale App is already a capable internal production tool: it has a fast mobile workflow, a large searchable product/variant catalog, point correction, history, administration, feedback, offline-tolerant synchronization, a local-only privacy mode, session revocation, signed CSRF protection, automated backups, restore verification, and a substantial regression suite.

The main weakness is no longer missing application functionality. It is **release discipline**: the live feature set must be consolidated into a clean, tagged, reproducible Git release, and the documentation must be updated to match the code. Once that is done and a fresh exhaustive live catalog audit is archived, the project will be in a much stronger position for a controlled colleague rollout and long-term maintenance.
