#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${1:-}"
TARGET="${DEPLOY_TARGET:-zkm@47.237.77.35}"
REMOTE_DIR="${DEPLOY_STAGING_DIR:-/home/zkm/last-mile-studio-bootstrap}"

if [[ -z "$RELEASE_DIR" || ! -f "$RELEASE_DIR/release.env" ]]; then
  printf 'Usage: %s .release/<release-id>\n' "$0" >&2
  exit 2
fi

if [[ "$REMOTE_DIR" != /home/zkm/* ]]; then
  printf 'DEPLOY_STAGING_DIR must stay under /home/zkm/.\n' >&2
  exit 2
fi

# shellcheck disable=SC1090
source "$RELEASE_DIR/release.env"

if [[ ! "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]]; then
  printf 'Invalid release ID: %s\n' "$RELEASE_ID" >&2
  exit 2
fi

if [[ ! "$ARCHIVE_NAME" =~ ^last-mile-studio-[0-9TZ-]+[0-9a-f]{12}\.tar\.gz$ ]]; then
  printf 'Invalid archive name: %s\n' "$ARCHIVE_NAME" >&2
  exit 2
fi

BASELINE_PATH="$RELEASE_DIR/route-baseline.txt"
ssh -o BatchMode=yes "$TARGET" \
  'for path in / /espur/ /modelselect/ /healthz; do curl -sS -o /dev/null -w "$path %{http_code} %{content_type} %{redirect_url}\n" "http://127.0.0.1$path"; done' \
  > "$BASELINE_PATH"

ssh -o BatchMode=yes "$TARGET" "mkdir -p '$REMOTE_DIR'"
scp -q \
  "$RELEASE_DIR/release.env" \
  "$RELEASE_DIR/release-manifest.json" \
  "$RELEASE_DIR/$ARCHIVE_NAME" \
  "$RELEASE_DIR/$ARCHIVE_NAME.sha256" \
  "$BASELINE_PATH" \
  "$TARGET:$REMOTE_DIR/"
scp -q -r "$REPO_ROOT/deploy" "$TARGET:$REMOTE_DIR/"

ssh -o BatchMode=yes "$TARGET" \
  "cd '$REMOTE_DIR' && sha256sum -c '$ARCHIVE_NAME.sha256'"

printf 'Staged release %s at %s:%s\n' "$RELEASE_ID" "$TARGET" "$REMOTE_DIR"
printf 'Next: sudo CERTBOT_EMAIL=you@example.com bash %s/deploy/bootstrap-root.sh\n' "$REMOTE_DIR"
