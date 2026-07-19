# Last Mile Studio UI Baseline

Date: 2026-07-19

Scope: design audit only; no application, test, dependency, script, or runtime changes

Evidence: current `main` worktree, source inspection, automated browser audit, and screenshots at 1280×800, 1440×900, and 1920×1080

## Executive assessment

Last Mile Studio already has the right product center: a source-first canvas with visible document structure, direct manipulation, an inspector, and an explicit source drawer. Its dark, restrained visual language is closer to a precision workstation than a generic dashboard. The redesign should refine that foundation rather than replace it.

The principal problem is information architecture, not ornament. Page management, build playback, build authoring, selection alignment, canvas geometry, and zoom all compete in the center toolbar. Pages also consume a second horizontal band, while Build is repeated between the center and inspector. The result is acceptable at 1920 px, strained at 1440 px for decks, and clipped at 1280 px.

No P0 issue was found. The baseline has six P1 families: essential toolbar overflow, inaccessible or underspecified controls, undersized interactive typography and targets, weak contextual hierarchy, low-contrast secondary text, and a presentation-audit harness mismatch. These are redesign requirements, not authorization to change code in this audit phase.

## Audit method and evidence boundaries

Three lenses were applied in the required order:

1. **UI UX Pro Max** — queried for a dense desktop developer/editor system with low motion and low variance. Its initial marketing-oriented recommendation was rejected because oversized type, violet gradients, and hero composition conflict with the repository contract. The retained guidance is flat neutral surfaces, a single functional accent, 4/8-based spacing, visible focus, and a canvas-first hierarchy.
2. **Impeccable** — applied as an existing-product critique to information architecture, hierarchy, interaction cost, consistency, and finish. No product-context file was initialized because this phase may write only audit documents and artifacts.
3. **Web Design Guidelines** — applied to accessible names, labels, focus, keyboard alternatives, target size, status announcement, reduced motion, dialog behavior, and responsive overflow.

Evidence has three distinct meanings:

- Existing unit and browser tests are the **behavior oracle**. They establish current source synchronization, history, export, presentation, pages, build, fragments, and layout behavior.
- `scripts/ui-visual-audit.mjs` is a **structural metric**. It detects overflow, missing names, small controls, tiny interactive text, clipping, duplicate IDs, and runtime errors. It is not a substitute for human visual judgment.
- The 24 captured screenshots are the **visual judgment baseline**. They reveal hierarchy and density, but cannot alone prove behavior or accessibility.

## Current surface inventory

| Surface | Current responsibility | Main implementation | Assessment |
|---|---|---|---|
| Top bar | Product identity, import, undo/redo, presentation preview, export | `src/ui/editor-app.ts` `.topbar`, `#import-menu`, `#undo`, `#redo`, `#preview-presentation`, `#export-menu` | Global responsibility is sound; excessive empty center space at wide viewports and inconsistent icon treatment remain. |
| Left panel | Layer tree, add element, visibility/lock/z-order, hierarchy drag | `#layers-panel`, `#layers-tree`, `[data-layer-id]`, `[data-layer-action]` | Strong document model exposure, but it is permanently tied to Layers and cannot host Pages or Fragments context. |
| Canvas toolbar | Align/distribute, page navigation, build playback, canvas size, zoom | `.canvas-toolbar`, `#page-control`, `#build-control` | Primary density defect. Unrelated scopes share one non-wrapping horizontal band. |
| Pages filmstrip | Page thumbnails and duplicate/move/delete actions | `#page-filmstrip`, `#page-thumbnails` | Useful capability, but consumes scarce vertical canvas space and duplicates page navigation above. |
| Canvas | Sanitized derivative, pan/zoom, direct manipulation, status | `#canvas-viewport`, `#canvas-host`, `.canvas-status` | Correct product center. Authored geometry remains independent of viewport size. |
| Right panel | Build sequence and element properties in a vertical split | `#inspector-panel`, `#build-panel`, `#inspector-content` | Correct contextual destination, but simultaneous long stacks reduce overview and force extensive scrolling. |
| Source drawer | Locate/search/format/apply source and code editor | `#code-drawer`, `#toggle-code`, `#apply-code`, `#code-editor` | Correct source-first boundary. Collapsed state is compact and releases canvas height. |
| Import/export menus | Document, project, fragment, local library, automation actions | `#import-menu`, `#export-menu` | Capabilities are coherently grouped and should remain global. |
| Fragment dialogs | Save fragment, temporary clipboard, library, dependency report | `src/ui/fragment-workspace.ts` dialog/library IDs | Capable workflow, but small typography and modal density need normalization. |
| Preview dialogs | Choose preview origin, then run presentation | `#preview-choice-dialog`, `#presentation-dialog` | Product flow is coherent; the visual-audit scenario has not caught up with the choice step. |

## Primary user workflows

1. **Open or create a document** — import HTML/SVG/project/directory, paste source, or load an example; document kind changes labels and available presentation features.
2. **Navigate structure** — choose a layer or page, locate the same element between tree, canvas, inspector, and source, and preserve stable `data-editor-id` identity.
3. **Visually edit** — select one or more elements, transform on canvas, align/distribute, and edit geometry, type, appearance, attributes, and inline style.
4. **Author a presentation deck** — manage pages, assign elements to build groups, reorder build sequence, choose playback state, and preview from the start or current page.
5. **Work with fragments** — save a selection as `.vfrag`, use the temporary clipboard or local library, inspect variables/dependencies, and insert without executing untrusted code.
6. **Edit canonical source** — expand the drawer, locate/search/format, explicitly apply code, and return to a synchronized visual derivative.
7. **Export** — export HTML/SVG, a selected fragment, an editable project, a source/resource bundle, or structure JSON.

## Hierarchy, density, and consistency defects

### P1 — overloaded center command band

`.canvas-toolbar` simultaneously exposes selection alignment, page navigation, build playback, canvas dimensions, and zoom. These commands have four different scopes and no progressive disclosure. In the compact deck state the audit measured 640 px of horizontal overflow; the compact collapsed-deck state still overflowed by 168 px. At 1440 px the deck state overflowed by 480 px and the collapsed-deck state by 8 px.

Expected correction: keep a compact mode strip permanently visible, reveal selection actions only when a selection exists, and move management surfaces to their owning panels. Essential controls must never require horizontal page scrolling.

### P1 — duplicated page and build responsibilities

- Pages are represented by `#page-control` and again by `#page-filmstrip`.
- Build playback is in `#build-control`, while authoring is simultaneously in `#build-panel`.
- The inspector heading describes both “编排与属性,” yet the content has no explicit Design / Build / Advanced mental model.

Expected correction: one left contextual Pages destination, one right Build authoring grouping, and only compact previous/state/next playback controls in the canvas context.

### P1 — weak context priority in the inspector

The selected-element inspector is a long one-column form. In the 1440×900 selected baseline, appearance/shadow and advanced fields are below the initial fold. They remain reachable by panel scrolling, so this is not hard clipping, but the hierarchy makes common and advanced properties equally expensive to scan.

Expected correction: Design, Build, and Advanced groupings, with common selection properties first and durable state preserved when a grouping is collapsed or switched.

### P1 — small interaction targets and interactive type

The structural audit repeatedly found 20 px layer controls, 21 px Build controls, and 23 px page controls. These violate the repository's 28×28 px minimum icon-button target. The exhaustive 8–10 px interactive-text inventory appears below.

### P2 — inconsistent icon language

Undo/redo, add shape/text, z-order, favorite, disclosure, preview arrows, and several fragment/schema actions use Unicode glyphs as their visible meaning. Titles are inconsistent and several icon-only buttons lack an accessible name. A single local inline-SVG icon language is required.

### P2 — permanent panel copy competes with work content

Eyebrows, repeated headings, footnotes, and verbose tool labels consume space without establishing a clearer command hierarchy. The redesign should retain useful status and instructional copy, but place it at 11 px or larger and reserve permanent space for current context.

## Accessibility and keyboard defects

### P1 findings

- `src/ui/editor-app.ts` — the fill and stroke text inputs rendered with `[data-prop="fill"]` and `[data-prop="stroke"]` do not receive unique accessible names. Each shares a wrapping label with a color input; a label cannot name both controls. The selected scenario reports two unnamed visible controls at every viewport; SVG reports two at compact/standard and three at wide.
- `src/ui/editor-app.ts` — layer rows use `[data-layer-id]` and tree semantics but do not expose a complete roving-tabindex/tree keyboard interaction. Pointer selection, F2 rename after selection, and drag handles exist, but keyboard-only discovery and hierarchy reparenting are incomplete.
- `src/ui/editor-app.ts` — layer reparenting is primarily pointer-drag based (`[data-layer-drag-handle]`). Up/down z-order buttons do not provide an equivalent keyboard hierarchy move/reparent path.
- `#undo`, `#redo`, `#add-text`, `#add-shape`, page/build glyph buttons, and several fragment controls rely on `title` or visible glyphs rather than a consistent accessible-name contract.
- Controls below 28×28 px reduce pointer and touch precision even on desktop.

### P2 findings

- `#notice-bar`, `#toast`, `#document-status`, `#selection-status`, and `#sync-status` do not expose an explicit `aria-live` strategy. Status must be announced without repeatedly interrupting editing.
- CSS has transitions but no global `@media (prefers-reduced-motion: reduce)` rule. JavaScript checks reduced motion for one layer-scroll behavior, which is not a complete motion policy.
- `index.html` declares a dark color-scheme meta value, while the CSS does not set `color-scheme: dark`; native form controls should inherit the intended scheme explicitly.
- Dialogs need a documented focus-entry, focus-trap/native-dialog, Escape, focus-return, and `overscroll-behavior: contain` acceptance sequence.
- The Impeccable detector reported `fragment-workspace.ts`'s preview `<img>` without an initial `src`. Source inspection shows `src` is assigned after asynchronous load and has a fallback; this is a detector false positive, not a current defect.

## Existing 8–10 px interactive text that must be raised

All interactive text below must become at least 12 px. Metadata that is not itself interactive must become at least 11 px. This inventory is intentionally selector-level so implementation cannot silently retain tiny controls.

| Current selector or control family | Current size | Required treatment |
|---|---:|---|
| `.io-menu-panel button small` | 9 px | 11 px supporting text; button label 12–13 px |
| `.layer-actions button` | 10 px | 12 px, 28 px minimum target |
| `.layer-row` action/disclosure/drag controls | 8–10 px | 12 px text or 16 px SVG icon in 28 px target |
| `.page-control select` | 10 px | 12 px |
| `#build-view-mode` | 9 px | 12 px |
| `.page-filmstrip-actions button` | 9 px | 12 px |
| `.page-thumbnail` contents: `.page-thumbnail-number`, `.page-thumbnail-label`, `.page-thumbnail-builds` | 8–9 px | 11 px metadata within a 12 px control context |
| `.canvas-size-control select` | 9 px | 12 px |
| `.canvas-size-control input` | 10 px | 12 px |
| `.build-selection-row select`, `.build-selection-row button` | 9 px | 12 px |
| clickable/draggable `.build-group > header > strong` and `> span` | 10 / 8 px | 12 px title, 11 px metadata |
| `.build-group-actions button` | 8 px | 16 px icon or 12 px label, 28 px target |
| `.build-element span`, `.build-element code` inside interactive rows | 8 px | 11–12 px |
| `.build-drop-zone` | 7 px | 11 px minimum instructional label |
| `.identity-navigation button` | 9 px | 12 px |
| `.checkbox` | 9 px | 12 px |
| `.field > span` and `.field input, .field select, .field textarea` | 10 px | 12 px |
| `.wide-button` | 10 px | 12 px |
| `.shadow-preset small` | 8 px | 11 px metadata |
| `.shadow-control`, `.shadow-color`, and their output controls | 8–9 px | 11–12 px |
| `.code-toolbar button` | 10 px | 12 px |
| `.fragment-schema-row input, .fragment-schema-row select` | 10 px | 12 px |
| `.fragment-library-toolbar input, .fragment-library-toolbar select` | 10 px | 12 px |
| `.fragment-coordinate` interactive values | 10 px | 12 px |
| `.fragment-card-actions button`, interactive fragment `summary` controls | 8 px | 12 px or 16 px icon in 28 px target |

Related non-interactive metadata also needs normalization: `#page-count`, `#build-status`, canvas status/hint text, eyebrows, panel footnotes, fragment-card metadata, and drag/drop feedback must be at least 11 px.

## Contrast defects

Current `--muted-2: #5f6878` on `--surface-1: #11141b` measures approximately 3.28:1. It fails WCAG normal-text contrast and is frequently combined with 8–10 px type. Other subdued combinations range from approximately 3.1:1 to 4.34:1. The redesign must use at least `#8792a5` on the darkest and raised permanent surfaces, which remains approximately 4.82:1 even on `#202633`.

## Responsive and clipping defects

| Viewport/state | Structural result | Visual interpretation |
|---|---|---|
| 1280×800 default | `.canvas-toolbar` overflow: 60 px | Basic editing is usable, but the command band has no reserve capacity. |
| 1280×800 deck | Overflow: 640 px; `#canvas-width` clipped | Pages, Build, dimensions, and zoom cannot coexist in one permanent row. |
| 1280×800 deck collapsed | Overflow: 168 px; `#zoom-display` clipped | Collapsing the filmstrip does not solve toolbar scope overload. |
| 1280×800 selected/SVG | Inspector controls reported below viewport | Inspector scroll makes them reachable, but common/advanced grouping is missing. |
| 1440×900 deck | Overflow: 480 px | Standard desktop still fails the full deck command layout. |
| 1440×900 deck collapsed | Overflow: 8 px | Borderline fit is not a robust responsive strategy. |
| 1920×1080 default | No major overflow | Hierarchy is calm, but the top bar has unused space and context is still duplicated. |
| All presentation scenarios | Setup timeout waiting for `#presentation-dialog[open]` | Audit clicks Preview, but product first opens `#preview-choice-dialog`; captured files show the choice dialog, not presentation mode. |

The authored document itself did not change geometry across viewports. The responsive defects are confined to the application shell, which is the correct architectural boundary.

## Findings by severity

### P0 — release-stopping data loss, security, or inaccessible core task

None observed in this audit.

### P1 — must be resolved within the relevant migration phase

| ID | Finding | Exact location |
|---|---|---|
| B-P1-01 | Essential canvas commands overflow in deck states at compact and standard widths | `src/styles.css` `.canvas-toolbar`; `src/ui/editor-app.ts` `#page-control`, `#build-control`, `.canvas-size-control`, `.zoom-control` |
| B-P1-02 | Two visible fill/stroke text inputs have no unique accessible name | `src/ui/editor-app.ts` generated `[data-prop="fill"]`, `[data-prop="stroke"]` controls |
| B-P1-03 | Layer tree and hierarchy movement lack a complete keyboard interaction model | `src/ui/editor-app.ts` `#layers-tree`, `[data-layer-id]`, `[data-layer-drag-handle]` |
| B-P1-04 | Interactive type is 7–10 px and targets are 20–23 px across core/editor/fragment surfaces | `src/styles.css` selector inventory above; `src/ui/fragment-workspace.ts` generated controls |
| B-P1-05 | Pages and Build are duplicated across permanent regions; inspector context is not grouped | `#page-control`, `#page-filmstrip`, `#build-control`, `#build-panel`, `#inspector-content` |
| B-P1-06 | `--muted-2` and related subdued colors fail normal-text contrast | `src/styles.css :root`, current `--muted-2: #5f6878` |
| B-P1-07 | Presentation screenshot scenario does not complete the product's preview-choice flow | `scripts/ui-visual-audit.mjs` presentation setup vs. `src/ui/editor-app.ts` `#preview-choice-dialog` |

### P2 — important polish or hardening, deferrable only with an owner

| ID | Finding | Exact location |
|---|---|---|
| B-P2-01 | Inconsistent Unicode icon language and tooltip/accessibility treatment | `src/ui/editor-app.ts`, `src/ui/fragment-workspace.ts`, `src/ui/layout-controller.ts` generated glyph controls |
| B-P2-02 | Status and transient feedback lack an explicit live-region policy | `#notice-bar`, `#toast`, `#document-status`, `#selection-status`, `#sync-status` |
| B-P2-03 | No global reduced-motion CSS policy | `src/styles.css` transitions; missing `@media (prefers-reduced-motion: reduce)` |
| B-P2-04 | Dark native-control and dialog overscroll/focus contracts are not explicit | `src/styles.css`, `index.html`, all dialog surfaces |
| B-P2-05 | Inspector is scroll-reachable but has poor overview because common and advanced fields share one stream | `#inspector-content` |
| B-P2-06 | Fragment preview image detector warning is a known false positive and should be suppressed only if detector semantics are improved | `src/ui/fragment-workspace.ts` asynchronous preview image |

## Protected behavior and hook inventory

The following must remain stable whenever the associated feature exists:

- Global/document: `#import-menu`, `#export-menu`, `#export-document-action`, `#export-document-label`, `#preview-presentation`, `#undo`, `#redo`, `#document-status`, `#selection-status`, `#sync-status`.
- Structure/layout: `#layers-panel`, `#layers-tree`, `[data-layer-id]`, `[data-layer-action]`, `[data-layer-drag-handle]`, `[data-layout-toggle]`, `[data-layout-resizer]`.
- Canvas/pages/build: `#canvas-viewport`, `#canvas-host`, `#page-filmstrip`, `#page-thumbnails`, `#build-control`, `#build-panel`.
- Inspector/source: `#inspector-panel`, `#inspector-content`, `#code-drawer`, `#toggle-code`, `#apply-code`, `#code-editor`.
- Fragment workspace: all dialog/library IDs and `[data-fragment-action]`, `[data-fragment-id]`, `[data-fragment-version]`, `[data-schema-field]`.
- Serialization/automation: `[data-editor-id]`, `[data-editor-name]`, `[data-page-id]`, `[data-page-index]`, `[data-build]`, `[data-build-action]`, `[data-build-element-id]`, `[data-build-group]`, `[data-prop]`, `[data-shadow-part]`, `[data-shadow-output]`, `[data-shadow-preset]`, `[data-thumbnail-host]`, `[data-vfrag-definition-id]`, `[data-vfrag-definition-version]`.
- Layout persistence: storage key `last-mile-studio:layout:v1`; any schema change requires migration.

Additional active automation hooks to preserve include `[data-editor-build-visibility]`, `[data-editor-canvas-height]`, `[data-editor-canvas-width]`, `[data-editor-preview-page-root]`, `[data-editor-scale-x]`, `[data-editor-translate-x]`, `[data-font-status]`, `[data-inspector-action]`, `[data-label]`, `[data-layer-name]`, `[data-layer-toggle]`, and `[data-load-example]`.

## Screenshot index

All files are under `artifacts/ui-audit/`.

| Scenario | 1280×800 | 1440×900 | 1920×1080 |
|---|---|---|---|
| Default | `compact__default.png` | `standard__default.png` | `wide__default.png` |
| Selected element | `compact__selected.png` | `standard__selected.png` | `wide__selected.png` |
| Deck | `compact__deck.png` | `standard__deck.png` | `wide__deck.png` |
| Deck, pages collapsed | `compact__deck-collapsed.png` | `standard__deck-collapsed.png` | `wide__deck-collapsed.png` |
| SVG | `compact__svg.png` | `standard__svg.png` | `wide__svg.png` |
| Source expanded | `compact__code.png` | `standard__code.png` | `wide__code.png` |
| Fragment library | `compact__fragment-library.png` | `standard__fragment-library.png` | `wide__fragment-library.png` |
| Presentation | `compact__presentation.png` | `standard__presentation.png` | `wide__presentation.png` |

The three presentation files show the preview-origin choice dialog because of B-P1-07. The complete machine-readable audit is `artifacts/ui-audit/report.json`.
