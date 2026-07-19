# Codex task: Final UI hardening and release gate

Repository: `drinkle-T/HTML-editor`
Required branch: `main`

This is a bounded hardening task, not an opportunity for another redesign.

First perform a read-only review:

1. Compare the implementation with:
   - `docs/ui/UI_NORTH_STAR.md`
   - `docs/ui/UI_DESIGN_SYSTEM.md`
   - `docs/ui/UI_ACCEPTANCE.md`
2. Review the full changed UI scope with Impeccable.
3. Review it with Web Design Guidelines.
4. Inspect all screenshots at 1280×800, 1440×900, and 1920×1080.
5. Classify findings:
   - P0: broken behavior, inaccessible essential action, data/source risk, runtime error;
   - P1: major hierarchy, clipping, readability, focus, responsive, or consistency defect;
   - P2: polish or preference.

Then:

- fix only P0 and P1 findings;
- do not add features;
- do not perform unrelated refactors;
- do not weaken tests or acceptance thresholds;
- keep P2 findings documented for later.

Run:

```bash
bash scripts/ui-gate.sh release
```

Also inspect:

```bash
git diff --check
git diff --stat
git status --short
```

Final response must include:

- concise design result;
- changed files grouped by phase;
- all commands and pass/fail results;
- screenshot index;
- P0/P1 findings fixed;
- P2 findings deferred;
- known environment limitations;
- confirmation that source-first, stable-ID, viewport-invariance, history, export, fragment, and source-draft contracts remain intact.

Do not claim completion when any release command failed. State the exact failing command and evidence.
