#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_ROOT="${1:-$REPO_ROOT/.release}"
export npm_config_cache="${npm_config_cache:-$OUTPUT_ROOT/npm-cache}"

log() {
  printf '[build-release] %s\n' "$*"
}

cd "$REPO_ROOT"
mkdir -p "$OUTPUT_ROOT"

COMMIT="$(git rev-parse --short=12 HEAD)"
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$COMMIT"
RELEASE_DIR="$OUTPUT_ROOT/$RELEASE_ID"
ARCHIVE_NAME="last-mile-studio-$RELEASE_ID.tar.gz"
ARCHIVE_PATH="$RELEASE_DIR/$ARCHIVE_NAME"

log "installing the lockfile-exact dependency tree"
npm ci

log "running unit tests, typecheck, and the normal production build"
npm run check

log "running the real-browser smoke suite"
STUDIO_BASE_URL="${BROWSER_SMOKE_BASE_URL:-http://127.0.0.1:4174}" npm run test:browser

log "building the /last-mile-studio/ production artifact"
npm run build:production

log "running the built artifact with the production path and security headers"
npm run test:production

if [[ -n "$(find dist -type f -name '*.map' -print -quit)" ]]; then
  printf 'Production build unexpectedly contains source maps.\n' >&2
  exit 1
fi

if ! grep -q '/last-mile-studio/assets/' dist/index.html; then
  printf 'Production index.html does not reference /last-mile-studio/assets/.\n' >&2
  exit 1
fi

if [[ -e "$RELEASE_DIR" ]]; then
  printf 'Release directory already exists: %s\n' "$RELEASE_DIR" >&2
  exit 1
fi

mkdir -p "$RELEASE_DIR"
PACKAGE_ROOT="$(mktemp -d "$OUTPUT_ROOT/.package.XXXXXX")"
cleanup() {
  rm -rf "$PACKAGE_ROOT"
}
trap cleanup EXIT

mkdir -p "$PACKAGE_ROOT/last-mile-studio"
cp -a dist/. "$PACKAGE_ROOT/last-mile-studio/"

SOURCE_DATE_EPOCH="$(git show -s --format=%ct HEAD)"
tar \
  --sort=name \
  --mtime="@$SOURCE_DATE_EPOCH" \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  -C "$PACKAGE_ROOT" \
  -czf "$ARCHIVE_PATH" \
  last-mile-studio

ARCHIVE_SHA256="$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')"
TRACKED_DIRTY=false
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  TRACKED_DIRTY=true
fi

printf '%s  %s\n' "$ARCHIVE_SHA256" "$ARCHIVE_NAME" > "$RELEASE_DIR/$ARCHIVE_NAME.sha256"
printf \
  'RELEASE_ID=%q\nARCHIVE_NAME=%q\nARCHIVE_SHA256=%q\n' \
  "$RELEASE_ID" \
  "$ARCHIVE_NAME" \
  "$ARCHIVE_SHA256" \
  > "$RELEASE_DIR/release.env"
printf \
  '{\n  "application": "last-mile-studio",\n  "release_id": "%s",\n  "git_commit": "%s",\n  "tracked_worktree_dirty": %s,\n  "base_path": "/last-mile-studio/",\n  "archive": "%s",\n  "sha256": "%s",\n  "source_maps": false\n}\n' \
  "$RELEASE_ID" \
  "$(git rev-parse HEAD)" \
  "$TRACKED_DIRTY" \
  "$ARCHIVE_NAME" \
  "$ARCHIVE_SHA256" \
  > "$RELEASE_DIR/release-manifest.json"

log "release ready: $RELEASE_DIR"
log "sha256: $ARCHIVE_SHA256"
