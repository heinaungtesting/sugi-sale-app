#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: npm run restore -- /absolute/path/to/backup.dump" >&2
  exit 2
fi

INPUT_FILE="$1"
DB_DSN="${SIGMA_RAG_PG_DSN:-postgresql://sigma_rag@127.0.0.1:5433/sigma_rag}"
DOCKER_CONTAINER="${SUGI_POSTGRES_CONTAINER:-sigma-rag-postgres}"
TABLE_ARGS=(
  --table=sugi_users
  --table=sugi_sessions
  --table=sugi_point_campaigns
  --table=sugi_point_campaign_items
  --table=sugi_activity_logs
  --table=products
  --table=product_variants
  --table=sales_logs
  --table=sale_idempotency_receipts
  --table=enrichment_sources
  --table=enrichment_jobs
  --table=product_unique_feature_items
  --table=product_unique_summaries
  --table=enrichment_audit
  --table=product_research_sources
  --table=product_unique_features
)

if [ ! -f "$INPUT_FILE" ]; then
  echo "Backup file not found: $INPUT_FILE" >&2
  exit 2
fi

BACKUP_FILE="$(readlink -f "$INPUT_FILE")"
CHECKSUM_FILE="$BACKUP_FILE.sha256"
if [ ! -f "$CHECKSUM_FILE" ]; then
  echo "Checksum file not found: $CHECKSUM_FILE" >&2
  exit 2
fi
(
  cd "$(dirname "$BACKUP_FILE")"
  sha256sum -c "$(basename "$CHECKSUM_FILE")"
)

if command -v pg_restore >/dev/null 2>&1; then
  pg_restore --list "$BACKUP_FILE" >/dev/null
else
  docker exec -i "$DOCKER_CONTAINER" pg_restore --list < "$BACKUP_FILE" >/dev/null
fi

echo "Restoring Sugi tables from verified archive: $BACKUP_FILE" >&2
echo "This deletes current Sugi data first. Type RESTORE to continue:" >&2
read -r confirm
if [ "$confirm" != "RESTORE" ]; then
  echo "Restore cancelled." >&2
  exit 1
fi

TRUNCATE_SQL='TRUNCATE TABLE enrichment_audit, product_unique_feature_items, product_unique_summaries, enrichment_jobs, enrichment_sources, product_research_sources, product_unique_features, sale_idempotency_receipts, sugi_point_campaign_items, sugi_point_campaigns, sales_logs, product_variants, products, sugi_sessions, sugi_activity_logs, sugi_users RESTART IDENTITY CASCADE;'
RESTORE_SQL="$(mktemp)"
cleanup() {
  rm -f "$RESTORE_SQL"
}
trap cleanup EXIT
chmod 600 "$RESTORE_SQL"

if command -v psql >/dev/null 2>&1 && command -v pg_restore >/dev/null 2>&1; then
  pg_restore --data-only --disable-triggers --no-owner --no-privileges "${TABLE_ARGS[@]}" --file="$RESTORE_SQL" "$BACKUP_FILE"
  psql "$DB_DSN" --single-transaction -v ON_ERROR_STOP=1 -c "$TRUNCATE_SQL" -f "$RESTORE_SQL"
elif command -v docker >/dev/null 2>&1 && docker inspect -f '{{.State.Running}}' "$DOCKER_CONTAINER" 2>/dev/null | grep -qx true; then
  docker exec -i "$DOCKER_CONTAINER" pg_restore --data-only --disable-triggers --no-owner --no-privileges "${TABLE_ARGS[@]}" --file=- < "$BACKUP_FILE" > "$RESTORE_SQL"
  docker exec -i "$DOCKER_CONTAINER" psql -U sigma_rag -d sigma_rag --single-transaction -v ON_ERROR_STOP=1 -c "$TRUNCATE_SQL" -f - < "$RESTORE_SQL"
else
  echo "No usable restore method: install psql/pg_restore or run Docker container '$DOCKER_CONTAINER'." >&2
  exit 127
fi

echo "Restore complete." >&2
