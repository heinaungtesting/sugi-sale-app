# Sugi Sale App Production Runbook

This app is intended for Sugi staff use on the private Tailscale network.

## Production URLs

- Primary: `http://100.111.161.73:3100`
- Alternate: `http://100.111.161.73:8080`
- Health: `http://100.111.161.73:8080/api/health`

Do not expose this app to the public internet without adding login rate limiting, CSRF protection for write routes, HTTPS, and security headers.

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
npm ci
npm run build
systemctl --user restart sugi-sale-app.service sugi-sale-app-8080.service
systemctl --user --no-pager status sugi-sale-app.service sugi-sale-app-8080.service
curl -fsS http://100.111.161.73:8080/api/health
```

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

- No login rate limiting yet.
- No per-user audit export yet.
- No public internet hardening yet.
- `npm audit` currently reports a moderate `postcss` advisory through Next.js; do not run `npm audit fix --force` because it proposes a breaking downgrade path.
