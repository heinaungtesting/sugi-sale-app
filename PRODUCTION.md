# Sugi Sale App Production Runbook

This app is intended for Sugi staff use on the private Tailscale network.

## Production URLs

- Canonical HTTPS: `https://herme-agents.tail71ac56.ts.net`
- Canonical health: `https://herme-agents.tail71ac56.ts.net/api/health`
- Private direct service: `http://100.111.161.73:3100`
- Private alternate service: `http://100.111.161.73:8080`

Signed double-submit CSRF protection, origin checking, security headers, and HTTPS on the canonical Tailscale origin are implemented. Do not expose the app to the public internet without stronger edge-backed rate limiting, centralized monitoring/alerting, a public-ingress review, and an incident-response process.

## Required environment

Production must provide:

```bash
SUGI_SESSION_SECRET=<long random secret>
SIGMA_RAG_PG_DSN=postgresql://sigma_rag@127.0.0.1:5433/sigma_rag
NODE_ENV=production
SUGI_COOKIE_SECURE=false
```

`SUGI_COOKIE_SECURE=false` is acceptable only because this deployment is private HTTP over Tailscale. If you put the app behind HTTPS, remove it or set `SUGI_COOKIE_SECURE=true`.

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
  "version": "1.2.0",
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

- Login throttling is in-memory and suitable only for small private/Tailscale use. Use reverse-proxy or Redis-backed rate limiting before public exposure.
- No per-user audit export yet.
- No public internet edge-hardening or centralized monitoring yet.
- `npm audit` currently reports a moderate `postcss` advisory through Next.js; do not run `npm audit fix --force` because it proposes a breaking downgrade path.

## Anti-slow-internet: offline queue + idempotency

Sugi counter taps must succeed even when the store Wi-Fi drops. The app therefore pairs the server `/api/sales` route with a client-side queue and a stable per-tap idempotency key.

### Server

- The `sales_logs` table has an `idempotency_key TEXT` column with a partial unique index `(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.
- `POST /api/sales` accepts an optional `idempotency_key` (UUID-like, 8–128 chars, `[A-Za-z0-9_-]`). The route forwards it to `logSale`.
- `logSale` performs `INSERT ... ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING ...` and falls back to a `SELECT` to replay the original row when the key was already used. The first request wins; mismatched payloads on a duplicate key do **not** mutate the original sale.
- The `recordSaleWrite` rate budget is charged **only on new inserts**, not on idempotent replays, so a slow network retry cannot starve legitimate new taps.

### Client

- `lib/sale-queue.ts` is a client-only module that owns a persistent `localStorage` queue (`sugi-sale-queue-v1`).
- A tap is enqueued synchronously (no network wait, no busyId lock on the network) and appears instantly in the home recent list with a temp id.
- The queue drains in the background with bounded concurrency (2 in-flight) and exponential backoff (`0 → 1.5s → 4s → 9s`, up to 4 attempts) and a 10s per-request timeout.
- Permanent 4xx errors (other than `408` / `429`) skip retries; the entry transitions to `failed` so the user can tap to retry.
- A 30s `/api/health` probe plus `navigator.onLine` + the `online` / `offline` window events drive the connectivity pill in the header (`オンライン` / `同期中 N件` / `オフライン`).
- The same queue path is used by `SearchProductLogger` (home), `SalesCalendarClient` (calendar add), and `ProductTapList` (category page).
- After a `router.refresh()` the parent prunes any `synced` queue entries whose canonical sale id is now present in the server's authoritative `today.recent`, keeping the queue bounded.

### Caveats

- The queue uses `localStorage`; private-mode browsers that block it will fall back to in-memory only and lose unsynced taps when the tab is closed. The pill shows an `offline` state in that case so the user knows to keep the tab open.
- A cross-tab tap is safe: the server's `(user_id, idempotency_key)` unique index dedupes even if two tabs send the same key. The queue itself uses `BroadcastChannel` to keep the pill in sync across tabs.
