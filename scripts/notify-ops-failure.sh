#!/usr/bin/env bash
set -euo pipefail

UNIT="${1:-unknown.service}"
MESSAGE="Sugi operation failed: $UNIT on $(hostname) at $(date --iso-8601=seconds)"
JSON="{\"event\":\"systemd_unit_failed\",\"unit\":\"$UNIT\",\"result\":\"failure\",\"timestamp\":\"$(date --iso-8601=seconds)\"}"
printf '%s\n' "$JSON" | systemd-cat -t sugi-ops -p err || true

if [ -n "${SUGI_OPS_TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${SUGI_OPS_TELEGRAM_CHAT_ID:-}" ]; then
  curl -fsS --max-time 10 \
    --data-urlencode "chat_id=$SUGI_OPS_TELEGRAM_CHAT_ID" \
    --data-urlencode "text=$MESSAGE" \
    "https://api.telegram.org/bot${SUGI_OPS_TELEGRAM_BOT_TOKEN}/sendMessage" >/dev/null || true
fi
