#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${SUGI_BACKUP_DIR:-/home/hermes/backups/sugi-sale-app}"
DB_DSN="${SIGMA_RAG_PG_DSN:-postgresql://sigma_rag@127.0.0.1:5433/sigma_rag}"
DOCKER_CONTAINER="${SUGI_POSTGRES_CONTAINER:-sigma-rag-postgres}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/sugi-sale-app-$STAMP.dump"
TMP="$OUT.tmp"
LATEST="$BACKUP_DIR/latest.dump"

cleanup() {
  rm -f "$TMP"
}
trap cleanup EXIT

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

if command -v pg_dump >/dev/null 2>&1; then
  pg_dump "$DB_DSN" --format=custom --no-owner --no-privileges --file="$TMP"
elif command -v docker >/dev/null 2>&1 && docker inspect -f '{{.State.Running}}' "$DOCKER_CONTAINER" 2>/dev/null | grep -qx true; then
  docker exec "$DOCKER_CONTAINER" pg_dump -U sigma_rag -d sigma_rag \
    --format=custom --no-owner --no-privileges > "$TMP"
else
  echo "No usable backup method: install pg_dump or run Docker container '$DOCKER_CONTAINER'." >&2
  exit 127
fi

if [ ! -s "$TMP" ]; then
  echo "Backup validation failed: archive is empty." >&2
  exit 1
fi

if command -v pg_restore >/dev/null 2>&1; then
  pg_restore --list "$TMP" >/dev/null
else
  docker exec -i "$DOCKER_CONTAINER" pg_restore --list < "$TMP" >/dev/null
fi

mv "$TMP" "$OUT"
chmod 600 "$OUT"
(
  cd "$BACKUP_DIR"
  sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256"
)
chmod 600 "$OUT.sha256"
ln -sfn "$OUT" "$LATEST"
ln -sfn "$OUT.sha256" "$BACKUP_DIR/latest.dump.sha256"

find "$BACKUP_DIR" -type f -name 'sugi-sale-app-*.dump' -mtime +30 -delete
find "$BACKUP_DIR" -type f -name 'sugi-sale-app-*.dump.sha256' -mtime +30 -delete
printf 'Backup written and validated: %s\n' "$OUT"
printf '{"event":"backup_completed","result":"success","archive":"%s","timestamp":"%s"}\n' "$OUT" "$(date --iso-8601=seconds)" | systemd-cat -t sugi-ops -p info || true
