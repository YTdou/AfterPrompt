# Last Mile Studio Codex UI Kit

This kit is designed for branch:

```text
main
```

## Install into the repository

Copy the kit contents into the repository root while preserving paths.

Merge the two entries from `package-json-snippet.json` into the existing `package.json` scripts section:

```json
"ui:audit": "node scripts/ui-visual-audit.mjs",
"ui:gate": "bash scripts/ui-gate.sh"
```

Then:

```bash
chmod +x scripts/ui-gate.sh
npm ci
bash scripts/ui-gate.sh fast
```

Screenshots and the structural report are written to:

```text
artifacts/ui-audit/
```

Add this directory to `.gitignore` unless you intentionally want to version selected baselines:

```gitignore
/artifacts/
```

## Recommended Codex workflow

Use a fresh Codex thread for each phase.

1. Run `prompts/00-audit-and-design.md`.
2. Review the generated UI documents.
3. Run `prompts/10-foundation-and-shell.md`.
4. Run `prompts/REVIEW_LOOP.md`.
5. Run `prompts/20-navigation-pages-layers.md`.
6. Run `prompts/REVIEW_LOOP.md`.
7. Run `prompts/30-canvas-and-inspector.md`.
8. Run `prompts/REVIEW_LOOP.md`.
9. Run `prompts/40-dialogs-fragments-source.md`.
10. Run `prompts/REVIEW_LOOP.md`.
11. Run `prompts/90-final-hardening.md`.

Do not paste all implementation prompts into one task. Each phase is deliberately issue-sized and has its own rollback and test boundary.

## Skill names

The prompts refer to:

- UI UX Pro Max
- Impeccable
- Web Design Guidelines

Use the exact slug shown by your Codex installation. The natural-language instruction remains valid even when the installed slug differs.

## Gate modes

### Fast

For every meaningful patch:

```bash
bash scripts/ui-gate.sh fast
```

Runs typecheck, unit tests, a standard-viewport structural audit, and three screenshots.

### Checkpoint

At the end of a UI phase:

```bash
bash scripts/ui-gate.sh checkpoint
```

Runs the repository check, full browser smoke, and the complete screenshot matrix.

### Canvas

After canvas/layout/typography/presentation changes:

```bash
bash scripts/ui-gate.sh canvas
```

Adds layout parity and viewport invariance.

### Release

Before declaring the redesign complete:

```bash
bash scripts/ui-gate.sh release
```

Runs the full repository gate and treats structural-audit warnings as failures.

## Useful environment variables

```bash
CHROME_PATH=/path/to/chrome
STUDIO_BASE_URL=http://127.0.0.1:4173
UI_VIEWPORTS=1280x800,1440x900,1920x1080
UI_SCENARIOS=default,selected,deck,svg,code
UI_STRICT=1
UI_AUDIT_DIR=artifacts/ui-audit
EXPECTED_BRANCH=main
ALLOW_ANY_BRANCH=1
```

`ALLOW_ANY_BRANCH=1` should be used only after intentionally moving the work to a new reviewed branch.

## Harness philosophy

The screenshot harness is not the product oracle by itself.

- Existing unit/browser tests verify behavior.
- Layout-parity and viewport-invariance tests verify authored-document fidelity.
- The audit script verifies shell structure, overflow, target size, accessible naming, and runtime errors.
- Screenshots support human and skill-based visual judgment.

A screenshot change is expected during redesign. A behavior regression is not.
