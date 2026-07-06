import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const connectionString = process.env.SIGMA_RAG_PG_DSN ?? 'postgresql://sigma_rag@127.0.0.1:5433/sigma_rag';
const pool = new Pool({ connectionString });

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sugi_users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sugi_sessions (
      jti TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES sugi_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
  CREATE TABLE IF NOT EXISTS sugi_point_campaigns (
  campaign_month TEXT PRIMARY KEY,
  replace_all BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'applied')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ
  )
  `);

  await pool.query(`
  CREATE TABLE IF NOT EXISTS sugi_activity_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES sugi_users(id) ON DELETE SET NULL,
  actor_user_id BIGINT REFERENCES sugi_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sugi_activity_logs_created ON sugi_activity_logs(created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sugi_activity_logs_user ON sugi_activity_logs(user_id, created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      product_name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'ヘルスケア',
      point_value INTEGER NOT NULL DEFAULT 0 CHECK (point_value >= 0),
      nicknames TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      user_id BIGINT REFERENCES sugi_users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_variants (
      id BIGSERIAL PRIMARY KEY,
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      variant_label TEXT NOT NULL,
      display_shortcut TEXT,
      unit_count INTEGER NOT NULL DEFAULT 1 CHECK (unit_count > 0),
      point_value INTEGER NOT NULL DEFAULT 0 CHECK (point_value >= 0),
      nicknames TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (product_id, variant_label)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_logs (
      id BIGSERIAL PRIMARY KEY,
      sold_date DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Tokyo')::date),
      user_id BIGINT REFERENCES sugi_users(id),
      product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
      points_per_item INTEGER NOT NULL CHECK (points_per_item >= 0),
      total_points INTEGER GENERATED ALWAYS AS (quantity * points_per_item) STORED,
      idempotency_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sugi_point_campaign_items (
      id BIGSERIAL PRIMARY KEY,
      campaign_month TEXT NOT NULL REFERENCES sugi_point_campaigns(campaign_month) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('product', 'variant')),
      product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      variant_id BIGINT REFERENCES product_variants(id) ON DELETE CASCADE,
      product_name TEXT NOT NULL,
      variant_label TEXT,
      point_value INTEGER NOT NULL CHECK (point_value >= 0),
      aliases TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
      source JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sugi_point_campaign_items_month ON sugi_point_campaign_items(campaign_month)`);

  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES sugi_users(id)`);
  await pool.query(`ALTER TABLE sales_logs ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES sugi_users(id)`);
  await pool.query(`ALTER TABLE sales_logs ADD COLUMN IF NOT EXISTS idempotency_key TEXT`);
  // Partial unique index: enforces idempotency for keys that exist, but allows many
  // legacy rows where the column is NULL. The client always sends a key when retrying.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_sales_logs_user_idem ON sales_logs (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`);
  await pool.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS display_shortcut TEXT`);
  await pool.query(`
    UPDATE product_variants
    SET display_shortcut = CASE
      WHEN variant_label ~ '^\\d+' THEN regexp_replace(variant_label, '[^0-9].*$', '')
      WHEN lower(variant_label) = 'gel' THEN 'gel'
      ELSE variant_label
    END
    WHERE display_shortcut IS NULL OR trim(display_shortcut) = ''
  `);

  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_user_category ON products(user_id, category, is_active)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_active_visible ON products(user_id, is_active, product_name)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (product_name gin_trgm_ops)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_products_nicknames_gin ON products USING gin (nicknames)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_product_active ON product_variants(product_id, unit_count) WHERE is_active = TRUE`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_nicknames_gin ON product_variants USING gin (nicknames)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_label_trgm ON product_variants USING gin (variant_label gin_trgm_ops)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_shortcut_trgm ON product_variants USING gin (display_shortcut gin_trgm_ops)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_logs_user_date ON sales_logs(user_id, sold_date, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_logs_user_product ON sales_logs(user_id, product_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sugi_sessions_user_active ON sugi_sessions(user_id, expires_at) WHERE revoked_at IS NULL`);

  await pool.query(`
    UPDATE products
    SET category = CASE
      WHEN lower(COALESCE(category, '') || ' ' || COALESCE(product_name, '')) LIKE '%化粧%'
        OR lower(COALESCE(category, '') || ' ' || COALESCE(product_name, '')) LIKE '%cosmetic%'
        OR lower(COALESCE(category, '') || ' ' || COALESCE(product_name, '')) LIKE '%コスメ%'
        OR lower(COALESCE(category, '') || ' ' || COALESCE(product_name, '')) LIKE '%美容%'
        OR lower(COALESCE(category, '') || ' ' || COALESCE(product_name, '')) LIKE '%日焼け%'
        OR lower(COALESCE(category, '') || ' ' || COALESCE(product_name, '')) LIKE '%uv%'
        OR lower(COALESCE(category, '') || ' ' || COALESCE(product_name, '')) LIKE '%トーンアップ%'
        OR lower(COALESCE(category, '') || ' ' || COALESCE(product_name, '')) LIKE '%下地%'
        OR lower(COALESCE(category, '') || ' ' || COALESCE(product_name, '')) LIKE '%美白%'
      THEN '化粧品'
      ELSE 'ヘルスケア'
    END,
    updated_at = now()
  `);

  const username = process.env.SUGI_DEFAULT_USERNAME ?? 'staff1';
  const displayName = process.env.SUGI_DEFAULT_DISPLAY_NAME ?? 'Staff 1';
  const pin = process.env.SUGI_DEFAULT_PIN ?? '111111';
  const role = process.env.SUGI_DEFAULT_ROLE ?? 'admin';
  const pinHash = await bcrypt.hash(pin, 10);

  await pool.query(
    `INSERT INTO sugi_users (username, display_name, pin_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO UPDATE
     SET display_name = EXCLUDED.display_name,
         role = EXCLUDED.role,
         is_active = TRUE,
         updated_at = now()`,
    [username, displayName, pinHash, role]
  );

  console.log(`Migration complete. Default login: ${username} / ${pin}`);
}

main().finally(() => pool.end());
