import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const [username, displayName, pin, role = 'user'] = process.argv.slice(2);
if (!username || !displayName || !pin) {
  console.error('Usage: npm run seed:user -- <username> <displayName> <pin> [admin|user]');
  process.exit(1);
}
if (!['admin', 'user'].includes(role)) {
  console.error('role must be admin or user');
  process.exit(1);
}

const connectionString = process.env.SIGMA_RAG_PG_DSN ?? 'postgresql://sigma_rag@127.0.0.1:5433/sigma_rag';
const pool = new Pool({ connectionString });

async function main() {
  const pinHash = await bcrypt.hash(pin, 10);
  await pool.query(
    `INSERT INTO sugi_users (username, display_name, pin_hash, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO UPDATE
     SET display_name = EXCLUDED.display_name,
         pin_hash = EXCLUDED.pin_hash,
         role = EXCLUDED.role,
         is_active = TRUE,
         updated_at = now()`,
    [username, displayName, pinHash, role]
  );
  console.log(`User ready: ${username} (${displayName}, ${role})`);
}

main().finally(() => pool.end());
