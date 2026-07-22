#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${SUGI_BACKUP_DIR:-/home/hermes/backups/sugi-sale-app}"
INPUT_FILE="${1:-$BACKUP_DIR/latest.dump}"
DB_DSN="${SIGMA_RAG_PG_DSN:-postgresql://sigma_rag@127.0.0.1:5433/sigma_rag}"
DOCKER_CONTAINER="${SUGI_POSTGRES_CONTAINER:-sigma-rag-postgres}"
TEST_DB="sugi_restore_verify_$(date +%Y%m%d_%H%M%S)_$$"
CREATED=0
MIGRATE_LOG="$(mktemp)"

cleanup() {
  rm -f "$MIGRATE_LOG"
  if [ "$CREATED" -eq 1 ]; then
    docker exec "$DOCKER_CONTAINER" dropdb -U sigma_rag --if-exists "$TEST_DB" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [ ! -f "$INPUT_FILE" ]; then
  echo "Backup archive not found: $INPUT_FILE" >&2
  exit 2
fi
BACKUP_FILE="$(readlink -f "$INPUT_FILE")"
CHECKSUM_FILE="$BACKUP_FILE.sha256"
if [ ! -f "$CHECKSUM_FILE" ]; then
  echo "Checksum file not found: $CHECKSUM_FILE" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1 || ! docker inspect -f '{{.State.Running}}' "$DOCKER_CONTAINER" 2>/dev/null | grep -qx true; then
  echo "Restore verification requires running PostgreSQL container '$DOCKER_CONTAINER'." >&2
  exit 127
fi
if ! command -v pg_restore >/dev/null 2>&1; then
  echo "Restore verification requires host pg_restore." >&2
  exit 127
fi

(
  cd "$(dirname "$BACKUP_FILE")"
  sha256sum -c "$(basename "$CHECKSUM_FILE")"
)
pg_restore --list "$BACKUP_FILE" >/dev/null

docker exec "$DOCKER_CONTAINER" createdb -U sigma_rag "$TEST_DB"
CREATED=1
docker exec "$DOCKER_CONTAINER" psql -U sigma_rag -d "$TEST_DB" -v ON_ERROR_STOP=1 \
  -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;' >/dev/null

TEST_DSN="$(BASE_DSN="$DB_DSN" TEST_DB="$TEST_DB" node -e '
  const fs = require("node:fs");
  const os = require("node:os");
  const url = new URL(process.env.BASE_DSN);
  if (!url.password) {
    const pgpassPath = process.env.PGPASSFILE || `${os.homedir()}/.pgpass`;
    const lines = fs.readFileSync(pgpassPath, "utf8").split(/\r?\n/);
    const baseDb = url.pathname.replace(/^\//, "");
    const unescapeField = (value) => value.replace(/\\:/g, ":").replace(/\\\\/g, "\\");
    for (const line of lines) {
      if (!line || line.startsWith("#")) continue;
      const fields = line.split(/(?<!\\):/).map(unescapeField);
      if (fields.length !== 5) continue;
      const [host, port, database, user, password] = fields;
      const matches = (field, value) => field === "*" || field === value;
      if (matches(host, url.hostname) && matches(port, url.port || "5432") && matches(database, baseDb) && matches(user, decodeURIComponent(url.username))) {
        url.password = password;
        break;
      }
    }
    if (!url.password) throw new Error("No matching PostgreSQL password found for isolated restore verification");
  }
  url.pathname = `/${process.env.TEST_DB}`;
  process.stdout.write(url.toString());
')"

docker exec -i "$DOCKER_CONTAINER" pg_restore -U sigma_rag -d "$TEST_DB" \
  --exit-on-error --no-owner --no-privileges < "$BACKUP_FILE"
if ! SIGMA_RAG_PG_DSN="$TEST_DSN" \
  SUGI_DEFAULT_USERNAME=restore_verify_seed \
  SUGI_DEFAULT_DISPLAY_NAME='Restore Verify Seed' \
  SUGI_DEFAULT_PIN=739152 \
  npm run migrate >"$MIGRATE_LOG" 2>&1; then
  cat "$MIGRATE_LOG" >&2
  exit 1
fi

# Exercise the exact operator restore path against the isolated database. The
# restore script truncates and reloads in one transaction, so a failure rolls back.
printf 'RESTORE\n' | SIGMA_RAG_PG_DSN="$TEST_DSN" \
  SUGI_POSTGRES_CONTAINER="$DOCKER_CONTAINER" \
  bash scripts/restore-db.sh "$BACKUP_FILE" >/dev/null

COUNTS="$(docker exec "$DOCKER_CONTAINER" psql -U sigma_rag -d "$TEST_DB" -At -F '|' -v ON_ERROR_STOP=1 -c \
  'SELECT (SELECT COUNT(*) FROM sugi_users), (SELECT COUNT(*) FROM products), (SELECT COUNT(*) FROM sales_logs);')"
IFS='|' read -r USERS PRODUCTS SALES <<< "$COUNTS"
if [ "${USERS:-0}" -lt 1 ] || [ "${PRODUCTS:-0}" -lt 1 ]; then
  echo "Restore verification failed: expected non-empty users and products (users=$USERS products=$PRODUCTS sales=$SALES)." >&2
  exit 1
fi

DANGLING="$(docker exec "$DOCKER_CONTAINER" psql -U sigma_rag -d "$TEST_DB" -At -v ON_ERROR_STOP=1 -c '
  SELECT
    (SELECT COUNT(*) FROM sale_idempotency_receipts r LEFT JOIN sales_logs s ON s.id = r.sale_id WHERE s.id IS NULL)
    + (SELECT COUNT(*) FROM sales_logs s LEFT JOIN sugi_users u ON u.id = s.user_id WHERE u.id IS NULL)
    + (SELECT COUNT(*) FROM sales_logs s LEFT JOIN products p ON p.id = s.product_id WHERE p.id IS NULL)
    + (SELECT COUNT(*) FROM product_variants v LEFT JOIN products p ON p.id = v.product_id WHERE p.id IS NULL);
')"
if [ "$DANGLING" -ne 0 ]; then
  echo "Restore verification failed: dangling relationship count=$DANGLING." >&2
  exit 1
fi

printf 'Restore verification passed: archive=%s users=%s products=%s sales=%s dangling=%s\n' \
  "$BACKUP_FILE" "$USERS" "$PRODUCTS" "$SALES" "$DANGLING"
