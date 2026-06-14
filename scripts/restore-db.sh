#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: npm run restore -- /absolute/path/to/backup.sql" >&2
  exit 2
fi

BACKUP_FILE="$1"
DB_DSN="${SIGMA_RAG_PG_DSN:-}"
DOCKER_CONTAINER="${SUGI_POSTGRES_CONTAINER:-sigma-rag-postgres}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 2
fi

echo "Restoring Sugi tables from: $BACKUP_FILE" >&2
echo "This deletes current Sugi data first. Type RESTORE to continue:" >&2
read -r confirm
if [ "$confirm" != "RESTORE" ]; then
  echo "Restore cancelled." >&2
  exit 1
fi

TRUNCATE_SQL='TRUNCATE TABLE sales_logs, product_variants, products, sugi_users RESTART IDENTITY CASCADE;'

if command -v psql >/dev/null 2>&1 && [ -n "$DB_DSN" ]; then
  psql "$DB_DSN" -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
  psql "$DB_DSN" -v ON_ERROR_STOP=1 -c "$TRUNCATE_SQL"
  psql "$DB_DSN" -v ON_ERROR_STOP=1 --file="$BACKUP_FILE"
elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$DOCKER_CONTAINER"; then
  docker exec -i "$DOCKER_CONTAINER" psql -U sigma_rag -d sigma_rag -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
  docker exec -i "$DOCKER_CONTAINER" psql -U sigma_rag -d sigma_rag -v ON_ERROR_STOP=1 -c "$TRUNCATE_SQL"
  docker exec -i "$DOCKER_CONTAINER" psql -U sigma_rag -d sigma_rag -v ON_ERROR_STOP=1 < "$BACKUP_FILE"
else
  echo "No usable restore method: set SIGMA_RAG_PG_DSN with host psql, or run Docker container '$DOCKER_CONTAINER'." >&2
  exit 127
fi

echo "Restore complete." >&2
