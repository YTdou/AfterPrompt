# Last Mile Studio — UI Redesign Agent Contract

## Operating scope

- Work only on branch `codex/self-check-20260718`.
- Before editing, run:
  - `git branch --show-current`
  - `git status --short`
  - `node --version`
- Stop on a branch mismatch. Do not reset, discard, overwrite, or reformat unrelated work.
- Use Node.js 22 or newer.
- Do not create or migrate to React, Vue, Svelte, Tailwind, or another UI framework.
- Do not add a production dependency without explicit user approval.
- Keep each implementation phase independently reviewable. Prefer at most 5 source files and roughly 500 non-generated changed lines per phase. Split larger work.

## Read before changing UI

Read these files before the first edit:

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/SELF_CHECK_CAMPAIGN_01.md`
4. `docs/SELF_CHECK_CAMPAIGN_02.md`
5. `package.json`
6. `src/ui/editor-app.ts`
7. `src/ui/layout-controller.ts`
8. `src/ui/fragment-workspace.ts`
9. `src/ui/code-editor.ts`
10. `src/styles.css`
11. `scripts/browser-smoke.mjs`
12. all files under `docs/ui/` when present

## Product truth and architectural invariants

- `SourceDocument.document` remains the canonical editing state.
- The visual canvas remains a sanitized derivative of the canonical HTML/SVG document.
- Do not introduce a private UI model that becomes a second source of truth.
- Preserve standard HTML/SVG serialization and stable `data-editor-id` identity.
- Do not execute imported scripts, inline event handlers, or untrusted local commands.
- Visual changes must not alter page/build semantics, selection semantics, history behavior, export behavior, fragment storage behavior, or source synchronization unless the phase explicitly changes the product contract and adds matching tests.
- Keep canvas layout independent from viewport size. App-shell responsiveness must not mutate authored document geometry.

## Design north star

Build a **precision creative workstation**, not a SaaS dashboard or marketing site.

The UI should feel like a disciplined intersection of Figma, Framer, VS Code, and Linear:

- canvas-first;
- low-chroma neutral dark surfaces;
- high information density without tiny text;
- clear selection, focus, hierarchy, and state;
- restrained motion;
- strong keyboard accessibility;
- minimal ornament;
- global actions separated from selection-specific actions.

Avoid:

- glassmorphism;
- neon/cyberpunk styling;
- blue-purple decorative gradients;
- oversized radii;
- ornamental cards around every section;
- large soft shadows on permanent panels;
- decorative grid backgrounds outside the actual canvas;
- animation that does not communicate state;
- framework migration disguised as redesign work.

## UI system constraints

- Keep visual tokens in `:root` and use semantic names.
- Target UI text: 12–13 px.
- Helper/metadata text: at least 11 px unless a documented exception is non-interactive and still legible.
- Code text: 12 px or larger.
- Standard control height: 28–32 px.
- Icon-button hit area: at least 28×28 px.
- Radius scale: 4 / 6 / 8 px. Larger radii are reserved for dialogs or exceptional surfaces.
- Accent color is for focus, selection, active state, and the primary action—not decoration.
- Permanent panel separation should rely on surface value and 1 px borders, not heavy shadows.
- Use consistent inline SVG icons or a small local icon helper. Do not use ambiguous Unicode glyphs as the only meaning of an action.
- Every icon-only control needs an accessible name and tooltip.
- Preserve a visible `:focus-visible` treatment.
- Respect `prefers-reduced-motion`.
- Never hide an essential action behind hover-only UI.
- Do not reduce information density by replacing useful controls with unlabeled mystery icons.

## Information architecture target

Follow the approved `docs/ui/UI_DESIGN_SYSTEM.md` and `docs/ui/UI_MIGRATION_PLAN.md`. If they do not exist yet, create them in the audit phase before implementation.

Preferred structure:

- Top bar: document/global actions only.
- Optional 40–44 px activity rail: Pages, Layers, Fragments/Assets, History when supported by existing behavior.
- Left contextual panel: pages/layers/assets content, resizable and collapsible.
- Center: contextual canvas toolbar, page/build controls, canvas, compact status bar.
- Right inspector: Design, Build, and Advanced groupings without duplicating the same command in multiple permanent locations.
- Bottom source drawer: collapsed by default and still capable of releasing canvas height.

Do not invent unsupported product features such as cloud sync, collaboration, command search, or account state merely to fill the layout.

## Protected automation and behavior contract

Existing IDs and `data-*` attributes are automation hooks. Preserve them whenever their feature still exists. Important hooks include, but are not limited to:

- `#import-menu`
- `#export-menu`
- `#export-document-action`
- `#export-document-label`
- `#preview-presentation`
- `#undo`
- `#redo`
- `#document-status`
- `#selection-status`
- `#sync-status`
- `#layers-panel`
- `#layers-tree`
- `[data-layer-id]`
- `[data-layer-action]`
- `[data-layer-drag-handle]`
- `[data-layout-toggle]`
- `[data-layout-resizer]`
- `#canvas-viewport`
- `#canvas-host`
- `#page-filmstrip`
- `#page-thumbnails`
- `#build-control`
- `#build-panel`
- `#inspector-panel`
- `#inspector-content`
- `#code-drawer`
- `#toggle-code`
- `#apply-code`
- `#code-editor`
- fragment dialog and library IDs in `src/ui/fragment-workspace.ts`

Protected behavior:

- The source drawer starts collapsed.
- Its collapsed height remains at most 44 px.
- `#toggle-code` keeps the existing `展开源码` / `收起源码` states unless the product contract and browser smoke are intentionally updated together.
- Import/export document labels continue to reflect HTML/SVG state.
- Resizers remain usable by pointer and keyboard.
- Collapsed layout preferences remain persisted. If a storage schema changes, migrate the previous state instead of silently discarding it.
- Tests must not be weakened merely to accommodate new markup. Prefer preserving semantic hooks. Any selector change must retain or improve behavioral coverage.

## Skill order

Use the three installed skills explicitly in this order for each phase:

1. **UI UX Pro Max**
   - derive or consult the design system;
   - select density, typography, spacing, color, and interaction rules;
   - do not let it blindly rewrite the application.
2. **Impeccable**
   - audit hierarchy, information architecture, interaction cost, consistency, and finish;
   - use it again after implementation as a critic.
3. **Web Design Guidelines**
   - run after implementation for accessibility, focus, labeling, keyboard, responsive, and web-interface compliance.

If the installed skill slug differs, use the exact installed name shown by Codex. Skill advice is subordinate to this repository contract and the product architecture.

## Bounded implementation loop

For every phase:

1. **Observe**
   - read the approved UI docs;
   - inspect the exact current files;
   - run the current fast gate;
   - capture baseline screenshots.
2. **State the contract**
   - list the behaviors and selectors that must remain stable;
   - list the files you expect to change;
   - state what is explicitly out of scope.
3. **Patch one coherent surface**
   - avoid opportunistic refactors;
   - keep behavior changes separate from visual changes;
   - do not edit tests before reproducing a real contract mismatch.
4. **Prove**
   - run the fast gate;
   - run the phase-specific checkpoint;
   - capture after screenshots at the required viewports;
   - inspect `git diff --check` and `git diff --stat`.
5. **Critique**
   - use Impeccable and Web Design Guidelines on the changed scope;
   - classify findings as P0/P1/P2;
   - fix P0 and P1 within scope.
6. **Bound the loop**
   - maximum three repair passes per phase;
   - if the same failure repeats twice, revert the smallest failed patch, reduce scope, and report the blocker;
   - never loop by weakening assertions.

## Test ladder

Bootstrap once:

```bash
npm ci
chmod +x scripts/ui-gate.sh
```

Every meaningful patch:

```bash
bash scripts/ui-gate.sh fast
```

At the end of each UI phase:

```bash
bash scripts/ui-gate.sh checkpoint
```

After canvas, pages, zoom, layout-controller, typography, or presentation-shell changes:

```bash
bash scripts/ui-gate.sh canvas
```

Before declaring the redesign complete:

```bash
bash scripts/ui-gate.sh release
```

## Definition of done

A phase is complete only when:

- the approved UI acceptance criteria for that phase are met;
- behavior and automation hooks are preserved;
- no browser console/page/request error was introduced;
- screenshots exist for compact, standard, and wide desktop viewports;
- the relevant gate passes;
- P0/P1 skill-review findings are resolved;
- the diff contains no unrelated cleanup;
- the final report lists changed files, tests run, screenshot paths, known caveats, and any deliberately deferred P2 findings.
