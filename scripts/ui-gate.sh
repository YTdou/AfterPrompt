#!/usr/bin/env bash
set -Eeuo pipefail

MODE="${1:-fast}"
EXPECTED_BRANCH="${EXPECTED_BRANCH:-main}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[ui-gate] not inside a git worktree" >&2
  exit 2
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [[ "${ALLOW_ANY_BRANCH:-0}" != "1" && "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "[ui-gate] expected branch '$EXPECTED_BRANCH', found '$CURRENT_BRANCH'" >&2
  exit 2
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if (( NODE_MAJOR < 22 )); then
  echo "[ui-gate] Node.js 22+ is required; found $(node --version)" >&2
  exit 2
fi

if [[ ! -d node_modules ]]; then
  echo "[ui-gate] node_modules is missing; run npm ci first" >&2
  exit 2
fi

echo "[ui-gate] branch=$CURRENT_BRANCH mode=$MODE node=$(node --version)"
git status --short
git diff --check

run_visual_fast() {
  UI_VIEWPORTS="1440x900" \
  UI_SCENARIOS="default,selected,deck" \
  node scripts/ui-visual-audit.mjs
}

run_visual_all() {
  UI_VIEWPORTS="1280x800,1440x900,1920x1080" \
  UI_SCENARIOS="default,selected,multi-selected,deck,deck-collapsed,svg,code,fragment-library,presentation" \
  node scripts/ui-visual-audit.mjs
}

case "$MODE" in
  fast)
    npm run typecheck
    npm test
    run_visual_fast
    ;;
  checkpoint)
    npm run check
    npm run test:browser
    run_visual_all
    ;;
  canvas)
    npm run check
    npm run test:browser
    npm run test:layout-parity
    npm run test:viewport-invariance
    run_visual_all
    ;;
  release)
    npm run check
    npm run test:browser
    npm run test:hotcarbon-export
    npm run test:layout-parity
    npm run test:viewport-invariance
    npm run test:oom-regression
    npm run build:production
    npm run test:production
    UI_STRICT=1 \
    UI_VIEWPORTS="1280x800,1440x900,1920x1080" \
    UI_SCENARIOS="default,selected,deck,deck-collapsed,svg,code,fragment-library,presentation" \
    node scripts/ui-visual-audit.mjs
    ;;
  *)
    echo "Usage: $0 {fast|checkpoint|canvas|release}" >&2
    exit 2
    ;;
esac

git diff --check
echo "[ui-gate] PASS mode=$MODE"
