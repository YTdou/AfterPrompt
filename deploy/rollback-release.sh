#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/var/www/last-mile-studio}"
REQUESTED_RELEASE="${1:-}"

if [[ -n "$REQUESTED_RELEASE" ]]; then
  if [[ ! "$REQUESTED_RELEASE" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]]; then
    printf 'Invalid release ID: %s\n' "$REQUESTED_RELEASE" >&2
    exit 2
  fi
  TARGET="releases/$REQUESTED_RELEASE"
else
  TARGET="$(readlink "$APP_ROOT/previous" 2>/dev/null || true)"
fi

if [[ -z "$TARGET" || "$TARGET" != releases/* || ! -f "$APP_ROOT/$TARGET/last-mile-studio/index.html" ]]; then
  printf 'Rollback target is missing or invalid: %s\n' "${TARGET:-<empty>}" >&2
  exit 1
fi

CURRENT_TARGET="$(readlink "$APP_ROOT/current" 2>/dev/null || true)"
if [[ -z "$CURRENT_TARGET" ]]; then
  printf 'Current release link is missing.\n' >&2
  exit 1
fi

PREVIOUS_NEXT="$APP_ROOT/.previous.next.$$"
CURRENT_NEXT="$APP_ROOT/.current.next.$$"
ln -s "$CURRENT_TARGET" "$PREVIOUS_NEXT"
ln -s "$TARGET" "$CURRENT_NEXT"
mv -Tf "$PREVIOUS_NEXT" "$APP_ROOT/previous"
mv -Tf "$CURRENT_NEXT" "$APP_ROOT/current"

printf 'Rolled back from %s to %s\n' "$CURRENT_TARGET" "$TARGET"
