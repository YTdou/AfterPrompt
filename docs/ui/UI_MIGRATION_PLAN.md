# Last Mile Studio UI Migration Plan

Status: proposed implementation sequence; this document does not authorize implementation

## Migration invariants

- Work only on `main`, preserve unrelated work, and use Node.js 22 or newer.
- No framework migration and no new production dependency.
- `SourceDocument.document` remains canonical; the canvas remains a sanitized derivative.
- Preserve standard HTML/SVG serialization, stable `data-editor-id`, selection, history, export, fragments, and source synchronization.
- App-shell responsiveness must never mutate authored document geometry.
- Preserve protected IDs, `data-*` hooks, keyboard resizers, layout preferences, and the source drawer's collapsed start and `展开源码` / `收起源码` labels.
- Each phase is one coherent surface, at most five source files and roughly 500 non-generated changed lines. If the coherent change exceeds that bound, split it before editing.
- Capture before/after screenshots at 1280×800, 1440×900, and 1920×1080. Run Impeccable and Web Design Guidelines critique after each implementation phase; fix in-scope P0/P1 findings within three passes.

## Universal protected contract

Protected selectors include:

`#import-menu`, `#export-menu`, `#export-document-action`, `#export-document-label`, `#preview-presentation`, `#undo`, `#redo`, `#document-status`, `#selection-status`, `#sync-status`, `#layers-panel`, `#layers-tree`, `[data-layer-id]`, `[data-layer-action]`, `[data-layer-drag-handle]`, `[data-layout-toggle]`, `[data-layout-resizer]`, `#canvas-viewport`, `#canvas-host`, `#page-filmstrip`, `#page-thumbnails`, `#build-control`, `#build-panel`, `#inspector-panel`, `#inspector-content`, `#code-drawer`, `#toggle-code`, `#apply-code`, `#code-editor`, all fragment dialog/library IDs, and the automation hooks inventoried in `UI_BASELINE.md`.

The persisted layout key `last-mile-studio:layout:v1` must remain readable. If a future phase adds rail/context state, it must migrate or extend the previous state rather than discard it.

## Phase 1 — visual foundations

**Coherent surface:** tokens and shared primitive styling only.

- Scope: semantic colors, type scale, spacing, radius, elevation, motion, control heights, focus-visible, native dark scheme, reduced motion, and local icon primitives.
- Expected files: `src/styles.css`; optionally one small local icon helper under `src/ui/`; matching focused tests only if behavior/markup requires them.
- Approximate diff: 250–450 lines.
- Must not change: layout regions, command placement, document behavior, selection behavior, serialization, or automation hooks.
- P1 targets: B-P1-04, B-P1-06; accessible-name fixes may be included only when contained to the primitive/control markup.
- Gate: `bash scripts/ui-gate.sh fast`, then `bash scripts/ui-gate.sh checkpoint`; screenshot comparison for all default/selected/SVG states.
- Rollback boundary: revert only token/primitive changes and the optional icon helper; no downstream phase depends on uncommitted foundation work.

## Phase 2 — global shell and activity rail

**Coherent surface:** top bar, workspace grid, and rail container.

- Scope: 48 px global top bar, 42 px activity rail with Layers/Pages/Fragments destinations, responsive column tokens, and preserved collapsible/resizable panel shell.
- Expected files: `src/ui/editor-app.ts`, `src/ui/layout-controller.ts`, `src/styles.css`, one focused UI/layout test file, `scripts/browser-smoke.mjs` only if new behavior needs coverage without changing existing assertions.
- Approximate diff: 350–500 lines.
- Must preserve: all global IDs, import/export document-kind labels, undo/redo, preview, layout keyboard resizing, existing storage restoration, minimum canvas width, source drawer height, and current active document state when switching rail destination.
- Must not invent: History, Search, cloud, collaboration, account, or settings destinations.
- Gate: fast + checkpoint + canvas; verify restored collapsed/width preferences and all global actions at three viewports.
- Rollback boundary: rail/shell markup, controller extension, and associated CSS/tests revert together; canonical document code remains untouched.

## Phase 3 — left contextual navigation

**Coherent surface:** Layers, Pages, and Fragments views inside the left panel.

- Scope: rail routing; move the existing page thumbnail/manage surface into Pages context; expose existing fragment discovery/insertion entry points in Fragments context; complete layer tree keyboard selection and reorder/reparent alternative.
- Expected files: `src/ui/editor-app.ts`, `src/ui/layout-controller.ts`, `src/ui/fragment-workspace.ts`, `src/styles.css`, one focused test/browser file.
- Approximate diff: 400–500 lines. Split Fragments into a follow-up subphase if this bound would be exceeded.
- Must preserve: `#layers-panel`, `#layers-tree`, `[data-layer-*]`, `#page-filmstrip`, `#page-thumbnails`, all page actions/shortcuts, fragment IDs/storage/import safety, stable selection identity, and tree/canvas/source synchronization.
- Gate: fast + checkpoint + canvas; keyboard-only sequence for tree navigation/reparent; page duplicate/reorder/delete; fragment library open/search/insert.
- Rollback boundary: each contextual view remains backed by existing commands. Revert routing/placement without reverting page, layer, or fragment domain behavior.

## Phase 4 — canvas context controls

**Coherent surface:** canvas mode row and conditional selection strip.

- Scope: reorganize `.canvas-toolbar`; retain compact page/build playback, canvas dimension, zoom/fit controls; show align/distribute only for relevant selection; use a contained overflow/popover at compact width.
- Expected files: `src/ui/editor-app.ts`, `src/styles.css`, one focused UI test, `scripts/ui-visual-audit.mjs` only to correct scenario setup or add structural assertions.
- Approximate diff: 250–450 lines.
- Must preserve: `#page-control`, `#build-control`, page/build keyboard shortcuts, canvas size semantics, zoom/fit, selection alignment semantics, `#canvas-viewport`, `#canvas-host`, and viewport-invariant authored layout.
- P1 targets: B-P1-01 and the presentation-scenario portion of B-P1-07 if the audit script is touched.
- Gate: fast + checkpoint + canvas; structural audit must report zero shell horizontal overflow for default, selected, deck, deck-collapsed, and SVG at all three viewports.
- Rollback boundary: toolbar markup/styles/tests revert as a unit; no model or canvas-renderer changes.

## Phase 5 — contextual inspector

**Coherent surface:** right inspector information architecture.

- Scope: Design, Build, and Advanced groupings; common properties first; Build appears only when supported; explicit accessible labels for color/text pairs; durable disclosure/tab state.
- Expected files: `src/ui/editor-app.ts`, `src/ui/layout-controller.ts`, `src/styles.css`, one inspector-focused test/browser file.
- Approximate diff: 350–500 lines.
- Must preserve: `#inspector-panel`, `#inspector-content`, `#build-panel`, `[data-prop]`, `[data-inspector-action]`, `[data-shadow-*]`, Build ordering/assignment, live source sync, history boundaries, and current field values while switching groups.
- P1 targets: B-P1-02, B-P1-05, and inspector portions of B-P1-04.
- Gate: fast + checkpoint + canvas; selected HTML/SVG, multi-selection, Build assignment/reorder, keyboard labels/focus, undo/redo, source synchronization.
- Rollback boundary: grouping shell and layout state revert without altering property/build command implementations.

## Phase 6 — fragment and transient workflows

**Coherent surface:** fragment save/library/report dialogs and shared transient-state behavior.

- Scope: normalize dialog hierarchy, typography, targets, icons, empty/error/loading states, focus return, Escape behavior, overscroll containment, and status/live-region policy.
- Expected files: `src/ui/fragment-workspace.ts`, `src/ui/editor-app.ts` only for shared transient/status primitive, `src/styles.css`, one fragment-focused test file, `scripts/browser-smoke.mjs` if needed.
- Approximate diff: 300–500 lines.
- Must preserve: all fragment IDs/data hooks, storage schema, `.vfrag` import/export, version/dependency reporting, temporary clipboard behavior, untrusted-script safety, and dialog automation coverage.
- P1/P2 targets: fragment portion of B-P1-04 and B-P2-01/B-P2-02/B-P2-04.
- Gate: fast + checkpoint; save, cancel, reopen, library filter, insert, dependency report, keyboard focus/return, empty/error state screenshots.
- Rollback boundary: transient presentation changes revert without modifying fragment serialization/storage logic.

## Phase 7 — source drawer and release hardening

**Coherent surface:** source workflow finish plus full-system acceptance.

- Scope: refine source toolbar hierarchy and expanded sizing; preserve explicit Apply boundary; finish cross-surface focus/status/icon consistency; correct remaining visual-audit scenario setup; resolve all in-scope P0/P1 findings.
- Expected files: `src/ui/editor-app.ts`, `src/ui/code-editor.ts`, `src/styles.css`, `scripts/ui-visual-audit.mjs`, one focused test/browser file.
- Approximate diff: 250–450 lines.
- Must preserve: `#code-drawer` starts collapsed and remains at most 44 px; `#toggle-code` text; `#apply-code`; `#code-editor`; locate/search/format; dirty/error semantics; history/source synchronization; minimum canvas area.
- Gate: fast + checkpoint + canvas + release; full screenshot matrix; `git diff --check`; `git diff --stat`; zero browser console/page/request errors.
- Rollback boundary: source-drawer styling/markup/audit setup reverts together; source parser/model changes are out of scope.

## Phase completion report template

Every implementation phase reports:

1. Actual files and changed-line count.
2. Acceptance criteria addressed by ID from `UI_ACCEPTANCE.md`.
3. Commands and exact results.
4. Before/after screenshot paths for compact, standard, and wide.
5. Impeccable and Web Design Guidelines findings classified P0/P1/P2.
6. P0/P1 fixes made and deliberately deferred P2 findings with owner.
7. Whether expected observations matched actual results.
8. Rollback boundary and residual risks.

Do not begin the next phase merely because the current diff compiles. A phase is reviewable only when its behavior oracle, structural metrics, visual judgment, and protected-hook audit agree.
