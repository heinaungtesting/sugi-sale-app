# Sugi Sale App Production Runbook

This app supports a private Tailscale deployment and an explicitly configured HTTPS Vercel deployment.

## Production URLs

- Canonical HTTPS: `https://herme-agents.tail71ac56.ts.net`
- Canonical health: `https://herme-agents.tail71ac56.ts.net/api/health`
- Private direct service: `http://100.111.161.73:3100`
- Private alternate service: `http://100.111.161.73:8080`

The primary mutation guard is tokenless same-origin protection. Every unsafe API request must carry the non-simple `X-Sugi-Request` marker, must not report `Sec-Fetch-Site: cross-site`, and must have an `Origin` or `Referer` hostname that exactly matches the allowed target hostname. This includes login and service-worker queue replay. Local and Tailscale hosts are built in; additional exact hosts use `SUGI_ALLOWED_HOSTS`, while Vercel's exact system-provided deployment, branch, and production hostnames are recognized automatically. Do not expose the app publicly without edge rate limiting, centralized monitoring/alerting, a public-ingress review, and an incident-response process.

## Required environment

Production must provide:

```bash
SUGI_SESSION_SECRET=<long random secret>
SIGMA_RAG_PG_DSN=postgresql://sigma_rag@127.0.0.1:5433/sigma_rag
NODE_ENV=production
SUGI_COOKIE_SECURE=false
SUGI_ALLOWED_HOSTS=herme-agents.tail71ac56.ts.net
TRUSTED_PROXY=false
```

`SUGI_COOKIE_SECURE=false` is acceptable only because this deployment is private HTTP over Tailscale. If you put the app behind HTTPS, remove it or set `SUGI_COOKIE_SECURE=true`.

For Vercel, set `SUGI_COOKIE_SECURE=true` and `TRUSTED_PROXY=true`. In Project Settings → Environment Variables, enable **Automatically expose System Environment Variables** so `VERCEL_URL`, `VERCEL_BRANCH_URL`, and `VERCEL_PROJECT_PRODUCTION_URL` are available at runtime. If that setting is disabled, `SUGI_ALLOWED_HOSTS` must explicitly list every Preview and Production hostname or login and all writes will return `403`. Configure `SUGI_ALLOWED_HOSTS` only with exact custom domains that are not represented by those system variables; never use wildcard hostnames.

Generate the session secret with:

```bash
openssl rand -base64 48
```

On this VPS the secret is stored in `.env.production` with `0600` permissions and loaded by systemd drop-ins:

```bash
systemctl --user cat sugi-sale-app.service sugi-sale-app-8080.service
```

## Create colleague accounts

Use one account per colleague. Do not share one common login.

```bash
npm run seed:user -- <username> '<Display Name>' <PIN> user
```

Example:

```bash
npm run seed:user -- yamada '山田さん' 482913 user
```

Admin account:

```bash
npm run seed:user -- manager 'Manager' 739204 admin
```

PIN guidance: use 6 digits minimum. Avoid `1111`, birthdays, or repeated digits.

## Deploy / restart

```bash
git status --short # must be empty
git checkout <release-tag>
npm ci
npm test
npm run build
systemctl --user restart sugi-sale-app.service sugi-sale-app-8080.service
systemctl --user --no-pager status sugi-sale-app.service sugi-sale-app-8080.service
curl -fsS https://herme-agents.tail71ac56.ts.net/api/health
```

The health response is the deployment identity. Confirm that `version`, `commit`, and `builtAt` match the checked-out release tag before announcing deployment:

```json
{
  "ok": true,
  "database": "ok",
  "version": "1.3.1",
  "commit": "<full-git-commit>",
  "builtAt": "<ISO-8601 timestamp>"
}
```

Never deploy from a dirty working tree. A production rollback is only reliable when the running build corresponds to a committed, immutable tag.

## Backup

Run manually:

```bash
npm run backup
```

Default location:

```text
/home/hermes/backups/sugi-sale-app/
```

Backups include:

- `sugi_users`
- `products`
- `product_variants`
- `sales_logs`

Retention: backup script deletes backup files older than 30 days.

## Restore

Use only if data is corrupted or lost.

```bash
npm run restore -- /home/hermes/backups/sugi-sale-app/sugi-sale-app-YYYYMMDD-HHMMSS.sql
```

The script requires typing `RESTORE` and truncates current Sugi tables first.

## Rollback

Use a tagged release or previous commit:

```bash
git log --oneline --decorate -10
git checkout <known-good-commit-or-tag>
npm ci
npm run build
systemctl --user restart sugi-sale-app.service sugi-sale-app-8080.service
curl -fsS http://100.111.161.73:8080/api/health
```

If database contents are wrong, restore from backup after code rollback.

## Colleague onboarding checklist

1. Create one account per person.
2. Send URL only over private channel.
3. Tell them not to share PINs.
4. Ask them to test:
   - login
   - search product
   - record one item
   - undo/correct one item
   - check Calendar
   - check All Records
5. Keep the first rollout small: 1-2 trusted colleagues for 2-3 shifts.

## Known limitations

- Login and sale-write throttling use atomic counters in the unlogged PostgreSQL table `sugi_rate_limits`, so limits survive app restarts and coordinate multiple app instances. Public exposure still requires an edge limiter.
- No per-user audit export yet.
- No public internet edge-hardening or centralized monitoring yet.
- `npm audit --omit=dev` currently reports the high-severity recursive-object stack-exhaustion advisory in `deepmerge-ts` through `@prisma/config` and the Prisma CLI. This checkout uses Prisma 7.9.1; those packages are marked `devOptional`, use only the repository-controlled `prisma.config.ts` during generation/migrations, and do not process request data in the deployed application. The checked Prisma 7.10.0 release still pins the affected `deepmerge-ts` 7.1.5, while npm's proposed forced fix downgrades Prisma to 6.12.0. Do not run `npm audit fix --force` or override Prisma's exact internal dependency; upgrade when Prisma publishes a compatible patched dependency and re-run the full build and migration verification.

## Anti-slow-internet: offline queue + idempotency

Sugi counter taps must succeed even when the store Wi-Fi drops. The app therefore pairs the server `/api/sales` route with a client-side queue and a stable per-tap idempotency key.

### Server

- The `sales_logs` table has an `idempotency_key TEXT` column with a partial unique index `(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.
- `POST /api/sales` accepts an optional `idempotency_key` (UUID-like, 8–128 chars, `[A-Za-z0-9_-]`). The route forwards it to `logSale`.
- `logSale` performs `INSERT ... ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING ...` and falls back to a `SELECT` to replay the original row when the key was already used. The first request wins; mismatched payloads on a duplicate key do **not** mutate the original sale.
- The Postgres-backed sale-write budget is refunded for idempotent replays, so a slow network retry cannot starve legitimate new taps.

### Client

- `lib/sale-queue.ts` uses the Promise-based `idb` wrapper over IndexedDB (`sugi-sale-queue`). Existing `sugi-sale-queue-v1` localStorage entries are read once for migration and deleted only after a successful IndexedDB transaction; new queue writes never use localStorage.
- A tap is enqueued synchronously (no network wait, no busyId lock on the network) and appears instantly in the home recent list with a temp id.
- The queue drains oldest-first with one in-flight mutation, preserving tap order, plus exponential backoff (`0 → 1.5s → 4s → 9s`, up to 4 attempts) and a 10s per-request timeout.
- Page and Service Worker drainers atomically claim each IndexedDB entry with a 90-second owner lease. Active foreign leases cannot be overwritten or deleted; expired leases are recoverable after a crash or tab kill.
- Every durable enqueue registers `sugi-sale-queue-sync` with the Service Worker Background Sync API. The worker replays IndexedDB entries oldest-first with idempotency and CSRF protection even after the PWA tab closes.
- Permanent 4xx errors (other than `408` / `429`) skip retries; the entry transitions to `failed` so the user can tap to retry.
- A 30s `/api/health` probe plus `navigator.onLine` + the `online` / `offline` window events drive the connectivity pill in the header (`オンライン` / `同期中 N件` / `オフライン`).
- The same queue path is used by `SearchProductLogger` (home), `SalesCalendarClient` (calendar add), and `ProductTapList` (category page).
- After a `router.refresh()` the parent prunes any `synced` queue entries whose canonical sale id is now present in the server's authoritative `today.recent`, keeping the queue bounded.

### Caveats

- If IndexedDB is unavailable, the queue is memory-only rather than blocking the main thread with synchronous localStorage writes. Unsynced memory-only taps can be lost when the tab closes.
- Browsers without Background Sync (including current iOS Safari versions) use the existing online/pageshow/health-probe retry path while the PWA is open; they cannot guarantee closed-tab replay because the platform does not provide that API.
- A cross-tab tap is safe: the server's `(user_id, idempotency_key)` unique index dedupes even if two tabs send the same key. The queue itself uses `BroadcastChannel` to keep the pill in sync across tabs.

## Active devices and session lifecycle

- `/sessions` lists the current user's active devices, creation time, and last-used time.
- Users can revoke one non-current session or all other sessions.
- Expired sessions are deleted automatically during login/device-list maintenance.
- PIN changes and account deactivation revoke existing sessions.
- A user is capped at ten active sessions; the oldest sessions are revoked first.

## Observability and alerts

- Application events are emitted as structured JSON to the systemd journal.
- Admin-only `GET /api/admin/metrics` reports process counters, queue gauges, and rolling P50/P95 latency.
- Sale creation, search, login, queue state, database failures, campaign mismatches, backups, and restore verification are tracked.
- Backup and restore-verification units use `OnFailure=sugi-ops-alert@%n.service`.
- `scripts/notify-ops-failure.sh` always writes a structured journal alert and optionally sends Telegram when `SUGI_OPS_TELEGRAM_BOT_TOKEN` and `SUGI_OPS_TELEGRAM_CHAT_ID` are configured.
- Metrics are process-local and reset on restart; this is intentionally lightweight for the private deployment.
