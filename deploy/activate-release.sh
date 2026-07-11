#!/usr/bin/env bash
set -Eeuo pipefail

STAGING_ROOT="${1:-}"
APP_ROOT="${APP_ROOT:-/var/www/last-mile-studio}"

if [[ -z "$STAGING_ROOT" || ! -f "$STAGING_ROOT/release.env" ]]; then
  printf 'Usage: %s <staging-root>\n' "$0" >&2
  exit 2
fi

if [[ ! -w "$APP_ROOT" ]]; then
  printf 'Application root is not writable: %s\n' "$APP_ROOT" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$STAGING_ROOT/release.env"

if [[ ! "$RELEASE_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]]; then
  printf 'Invalid release ID: %s\n' "$RELEASE_ID" >&2
  exit 2
fi

if [[ ! "$ARCHIVE_NAME" =~ ^last-mile-studio-[0-9TZ-]+[0-9a-f]{12}\.tar\.gz$ ]]; then
  printf 'Invalid archive name: %s\n' "$ARCHIVE_NAME" >&2
  exit 2
fi

ARCHIVE_PATH="$STAGING_ROOT/$ARCHIVE_NAME"
ACTUAL_SHA256="$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')"
if [[ "$ACTUAL_SHA256" != "$ARCHIVE_SHA256" ]]; then
  printf 'Checksum mismatch for %s\n' "$ARCHIVE_PATH" >&2
  exit 1
fi

RELEASES_DIR="$APP_ROOT/releases"
TARGET_DIR="$RELEASES_DIR/$RELEASE_ID"
TEMP_DIR="$RELEASES_DIR/.$RELEASE_ID.tmp.$$"
mkdir -p "$RELEASES_DIR"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

if [[ ! -d "$TARGET_DIR" ]]; then
  mkdir "$TEMP_DIR"
  tar --no-same-owner --no-same-permissions -xzf "$ARCHIVE_PATH" -C "$TEMP_DIR"
  if [[ ! -f "$TEMP_DIR/last-mile-studio/index.html" ]]; then
    printf 'Release archive does not contain last-mile-studio/index.html.\n' >&2
    exit 1
  fi
  chmod -R u=rwX,go=rX "$TEMP_DIR"
  mv "$TEMP_DIR" "$TARGET_DIR"
fi

if [[ ! -f "$TARGET_DIR/last-mile-studio/index.html" ]]; then
  printf 'Existing release is incomplete: %s\n' "$TARGET_DIR" >&2
  exit 1
fi

CURRENT_TARGET="$(readlink "$APP_ROOT/current" 2>/dev/null || true)"
if [[ -n "$CURRENT_TARGET" && "$CURRENT_TARGET" != "releases/$RELEASE_ID" ]]; then
  PREVIOUS_NEXT="$APP_ROOT/.previous.next.$$"
  ln -s "$CURRENT_TARGET" "$PREVIOUS_NEXT"
  mv -Tf "$PREVIOUS_NEXT" "$APP_ROOT/previous"
fi

CURRENT_NEXT="$APP_ROOT/.current.next.$$"
ln -s "releases/$RELEASE_ID" "$CURRENT_NEXT"
mv -Tf "$CURRENT_NEXT" "$APP_ROOT/current"

printf 'Activated release %s\n' "$RELEASE_ID"
printf 'Current target: %s\n' "$(readlink "$APP_ROOT/current")"
