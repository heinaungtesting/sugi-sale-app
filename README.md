# Sugi Sale Logger

Mobile-first multi-user sale logger for Sugi point products.

## Run

```bash
npm install
cp .env.example .env.local # optional; set SUGI_SESSION_SECRET for production
npm run migrate
npm run dev
```

## Run with Docker

For local phone/browser testing without installing Node/Postgres locally:

```bash
cp .env.docker.example .env.docker
# optional: edit .env.docker to change port, PIN, or username
docker compose --env-file .env.docker up --build
```

Open: <http://localhost:3100>

Default local Docker login from `.env.docker.example`:

- ID: `hein`
- PIN: `111111`

Useful commands:

```bash
# run in background
docker compose --env-file .env.docker up --build -d

# logs
docker compose logs -f app

# stop containers, keep database volume
docker compose down

# reset local Docker database (destructive)
docker compose down -v
```

Seed/override the login before migration:

```bash
SUGI_DEFAULT_USERNAME=staff1 SUGI_DEFAULT_DISPLAY_NAME='Staff 1' SUGI_DEFAULT_PIN=111111 npm run migrate
```

Create more users:

```bash
npm run seed:user -- staff1 'Staff 1' 111111 user
```

## Scope

- Login with pre-made ID/PIN.
- Main-page search-first product-family cards.
- Large variant buttons log exact SKU ×1 immediately.
- Point values stay hidden in the UI and are calculated backend-side.
- Totals/recent sales are scoped by `sales_logs.user_id`.
- Shared products: `products.user_id IS NULL`.
- Private products later: `products.user_id = current user id`.
