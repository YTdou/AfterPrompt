#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  printf 'Run this script through sudo.\n' >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$BASH_SOURCE")" && pwd)"
STAGING_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_IP="47.237.77.35"
DEPLOY_USER="zkm"
DEPLOY_GROUP="labadmins"
APP_INDEX="/var/www/last-mile-studio/current/last-mile-studio/index.html"
HTTPS_CONFIG="/etc/nginx/conf.d/last-mile-studio-https.conf"
HTTP_SNIPPET="/etc/nginx/snippets/last-mile-studio-http.conf"
SOURCE_HTTPS="$SCRIPT_DIR/nginx/last-mile-studio-https.conf"
SOURCE_HTTP="$SCRIPT_DIR/nginx/last-mile-studio-http-redirect.conf"
BACKUP_DIR="$STAGING_ROOT/public-path-backups/$(date -u +%Y%m%dT%H%M%SZ)"

for command in nginx systemctl curl install grep cut basename; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Required command is missing: %s\n' "$command" >&2
    exit 1
  fi
done

for path in "$APP_INDEX" "$HTTPS_CONFIG" "$HTTP_SNIPPET" "$SOURCE_HTTPS" "$SOURCE_HTTP"; do
  if [[ ! -f "$path" ]]; then
    printf 'Required file is missing: %s\n' "$path" >&2
    exit 1
  fi
done

ASSET_PATH="$(grep -o 'src="/[^"]*\.js"' "$APP_INDEX" | head -n 1 | cut -d'"' -f2)"
ASSET_RELATIVE="assets/$(basename "$ASSET_PATH")"
if [[ -z "$ASSET_PATH" || ! -f "/var/www/last-mile-studio/current/last-mile-studio/$ASSET_RELATIVE" ]]; then
  printf 'Could not resolve the active JavaScript asset from %s.\n' "$APP_INDEX" >&2
  exit 1
fi

install -d -m 0750 "$BACKUP_DIR"
cp -a "$HTTPS_CONFIG" "$BACKUP_DIR/last-mile-studio-https.conf"
cp -a "$HTTP_SNIPPET" "$BACKUP_DIR/last-mile-studio-http.conf"

rollback_on_error() {
  local exit_code="$?"
  trap - ERR
  printf 'Public-path migration failed; restoring Nginx configuration from %s\n' "$BACKUP_DIR" >&2
  cp -a "$BACKUP_DIR/last-mile-studio-https.conf" "$HTTPS_CONFIG"
  cp -a "$BACKUP_DIR/last-mile-studio-http.conf" "$HTTP_SNIPPET"
  if nginx -t; then
    systemctl reload nginx.service
  fi
  chown -R "$DEPLOY_USER:$DEPLOY_GROUP" "$BACKUP_DIR"
  exit "$exit_code"
}
trap rollback_on_error ERR

install -o root -g root -m 0644 "$SOURCE_HTTPS" "$HTTPS_CONFIG"
install -o root -g root -m 0644 "$SOURCE_HTTP" "$HTTP_SNIPPET"
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
  printf '%s returned %s; expected %s.\n' "$path" "$status" "$expected" >&2
  return 1
}

wait_for_status "/AfterPrompt/" "200"
wait_for_status "/AfterPrompt/healthz" "200"
wait_for_status "/AfterPrompt/$ASSET_RELATIVE" "200"
wait_for_status "/last-mile-studio/" "308"

chown -R "$DEPLOY_USER:$DEPLOY_GROUP" "$BACKUP_DIR"
trap - ERR

printf 'Public path migrated successfully.\n'
printf 'Canonical endpoint: https://%s/AfterPrompt/\n' "$SERVER_IP"
printf 'Legacy endpoint: https://%s/last-mile-studio/ -> 308\n' "$SERVER_IP"
printf 'Backup directory: %s\n' "$BACKUP_DIR"
