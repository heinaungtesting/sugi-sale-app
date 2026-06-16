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

  const username = process.env.SUGI_DEFAULT_USERNAME ?? 'staff1';
  const displayName = process.env.SUGI_DEFAULT_DISPLAY_NAME ?? 'Staff 1';
  const pin = process.env.SUGI_DEFAULT_PIN ?? '1111';
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
