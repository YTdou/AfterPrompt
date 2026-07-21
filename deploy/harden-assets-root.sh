#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  printf 'Run this script through sudo.\n' >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_IP="47.237.77.35"
APP_ROOT="/var/www/last-mile-studio/current/last-mile-studio"
TARGET_CONFIG="/etc/nginx/conf.d/last-mile-studio-https.conf"
SOURCE_CONFIG="$SCRIPT_DIR/nginx/last-mile-studio-https.conf"
BACKUP_CONFIG="$TARGET_CONFIG.pre-strict-assets-$(date -u +%Y%m%dT%H%M%SZ)"

ASSET_PATH="$(sed -n 's#.*src="\(/AfterPrompt/assets/[^"?]*\.js\)".*#\1#p' "$APP_ROOT/index.html" | head -n 1)"
ASSET_RELATIVE="$(printf '%s' "$ASSET_PATH" | sed 's#^/AfterPrompt/##')"
if [[ -z "$ASSET_PATH" || ! -f "$APP_ROOT/$ASSET_RELATIVE" ]]; then
  printf 'Could not resolve the current JavaScript asset from index.html.\n' >&2
  exit 1
fi

cp -a "$TARGET_CONFIG" "$BACKUP_CONFIG"

rollback_on_error() {
  local exit_code="$?"
  trap - ERR
  printf 'Asset hardening failed; restoring %s\n' "$BACKUP_CONFIG" >&2
  cp -a "$BACKUP_CONFIG" "$TARGET_CONFIG"
  if nginx -t; then
    systemctl reload nginx.service
  fi
  exit "$exit_code"
}
trap rollback_on_error ERR

install -o root -g root -m 0644 "$SOURCE_CONFIG" "$TARGET_CONFIG"
nginx -t
systemctl reload nginx.service

wait_for_status() {
  local path="$1"
  local expected="$2"
  local status=""
  local attempt
  for attempt in {1..50}; do
    status="$(curl \
      --silent \
      --output /dev/null \
      --write-out '%{http_code}' \
      --resolve "$SERVER_IP:443:127.0.0.1" \
      "https://$SERVER_IP$path" || true)"
    if [[ "$status" == "$expected" ]]; then
      return 0
    fi
    sleep 0.2
  done
  printf '%s returned %s; expected %s.\n' "$path" "${status:-<empty>}" "$expected" >&2
  return 1
}

wait_for_status "$ASSET_PATH" "200"
wait_for_status "$ASSET_PATH.map" "404"

trap - ERR
printf 'Strict asset routing is active.\n'
printf 'Existing asset: %s -> 200\n' "$ASSET_PATH"
printf 'Missing source map: %s.map -> 404\n' "$ASSET_PATH"
printf 'Backup: %s\n' "$BACKUP_CONFIG"
