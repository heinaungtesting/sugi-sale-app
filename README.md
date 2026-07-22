# Sugi Sale Logger

Mobile-first, multi-user sales-point logger for Sugi Pharmacy shift work. The project is a private, independently operated work-support tool; it is not an official Sugi Pharmacy service.

## Current release

- Application version: `1.3.1`
- Runtime: Node.js 22, Next.js 16, React 19, PostgreSQL
- Canonical private URL: `https://herme-agents.tail71ac56.ts.net`
- Build identity: `GET /api/health` returns the version, exact Git commit, and build timestamp.

## Main features

- ID/PIN login with per-user sales ownership and server-side session revocation
- Japanese-first mobile UI with optional English Home copy
- Product-family search by product name, alias, variant, and shortcut
- Visible point values and direct variant buttons
- Optimistic one-tap sale logging
- IndexedDB-backed offline queue with legacy localStorage migration, BroadcastChannel coordination, and server-side idempotency
- Zero-point assignment before logging
- Recent-sale quantity, undo, and point correction controls
- Monthly calendar and current-month logbook
- Product, variant, user, campaign, feedback, and activity administration
- Signed double-submit CSRF protection and role-based admin authorization
- Daily database backups and weekly isolated restore verification
- Separate `/local` PWA mode that stores profile, products, and sales only in IndexedDB
- Active-device management, individual/other-session revocation, expiry cleanup, PIN-change revocation, and a ten-session cap
- Structured JSON operational logs plus admin-only latency/counter metrics

See [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md) for the complete feature inventory, architecture, live counts, known limitations, and release gate.

## Development setup

```bash
npm install
cp .env.example .env.local
npm run migrate
npm run dev
```

Production requires a strong `SUGI_SESSION_SECRET`. Never commit `.env*` files.

## Test and build

```bash
npm test
npm run build
```

`npm run build` runs `scripts/generate-build-info.mjs` first and writes ignored build metadata to `public/build-info.json`.

## Local Docker environment

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up --build
```

Open <http://localhost:3100>. The sample credentials in `.env.docker.example` are for local development only.

Useful commands:

```bash
docker compose logs -f app
docker compose down
docker compose down -v # destructive local database reset
```

## Database migration and users

```bash
npm run migrate
npm run seed:user -- staff1 'Staff 1' 111111 user
```

Use one account per colleague and replace sample PINs immediately. Production PINs should contain at least six digits and must not be repeated/default values.

## Production deployment

Deploy a clean, immutable Git tag—not an arbitrary dirty working tree:

```bash
git status --short                         # must be empty
git checkout v1.3.1
npm ci
npm test
npm run build
systemctl --user restart sugi-sale-app.service sugi-sale-app-8080.service
curl -fsS https://herme-agents.tail71ac56.ts.net/api/health
```

The health response must identify the checked-out commit:

```json
{
  "ok": true,
  "database": "ok",
  "version": "1.3.1",
  "commit": "<full-git-commit>",
  "builtAt": "<ISO-8601 timestamp>"
}
```

See [`PRODUCTION.md`](PRODUCTION.md) for backup, restore, rollback, and colleague rollout procedures.

## Privacy boundary

Do not enter customer names, phone numbers, membership/payment data, symptoms, medical history, or consultation details. The server-backed app stores only operational account, product, point, feedback, session, audit, and sales-log data. `/local` stores its data on the current device only.
