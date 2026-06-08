# Sugi Sale Logger

Mobile-first multi-user sale logger for Sugi point products.

## Run

```bash
npm install
cp .env.example .env.local # optional; set SUGI_SESSION_SECRET for production
npm run migrate
npm run dev
```

Seed/override the login before migration:

```bash
SUGI_DEFAULT_USERNAME=staff1 SUGI_DEFAULT_DISPLAY_NAME='Staff 1' SUGI_DEFAULT_PIN=1111 npm run migrate
```

Create more users:

```bash
npm run seed:user -- staff1 'Staff 1' 1111 user
```

## Scope

- Login with pre-made ID/PIN.
- Main-page search-first product-family cards.
- Large variant buttons log exact SKU ×1 immediately.
- Point values stay hidden in the UI and are calculated backend-side.
- Totals/recent sales are scoped by `sales_logs.user_id`.
- Shared products: `products.user_id IS NULL`.
- Private products later: `products.user_id = current user id`.
