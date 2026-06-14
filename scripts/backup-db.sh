#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${SUGI_BACKUP_DIR:-/home/hermes/backups/sugi-sale-app}"
DB_DSN="${SIGMA_RAG_PG_DSN:-}"
DOCKER_CONTAINER="${SUGI_POSTGRES_CONTAINER:-sigma-rag-postgres}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/sugi-sale-app-$STAMP.sql"
LATEST="$BACKUP_DIR/latest.sql"
TABLE_ARGS=(
  --table=sugi_users
  --table=products
  --table=product_variants
  --table=sales_logs
)

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

if command -v pg_dump >/dev/null 2>&1 && [ -n "$DB_DSN" ]; then
  pg_dump "$DB_DSN" --data-only "${TABLE_ARGS[@]}" --file="$OUT"
elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$DOCKER_CONTAINER"; then
  docker exec "$DOCKER_CONTAINER" pg_dump -U sigma_rag -d sigma_rag --data-only "${TABLE_ARGS[@]}" > "$OUT"
else
  echo "No usable backup method: set SIGMA_RAG_PG_DSN with host pg_dump, or run Docker container '$DOCKER_CONTAINER'." >&2
  exit 127
fi

chmod 600 "$OUT"
ln -sfn "$OUT" "$LATEST"

find "$BACKUP_DIR" -type f -name 'sugi-sale-app-*.sql' -mtime +30 -delete
printf 'Backup written: %s\n' "$OUT"
