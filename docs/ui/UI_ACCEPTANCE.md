# Last Mile Studio UI Acceptance Contract

Status: measurable acceptance criteria for future implementation phases

## Evidence model

Acceptance requires three independent evidence types:

1. **Behavior oracle** — existing unit tests and browser smoke prove that editing, source synchronization, history, pages, Build, fragments, preview, export, and layout behavior remain correct. Passing screenshots cannot replace this oracle.
2. **Structural metric** — automated DOM/browser measurements prove names, target sizes, overflow, clipping, duplicate IDs, runtime errors, and stable hooks. Metrics do not decide whether the composition feels clear.
3. **Visual judgment** — human screenshot review judges hierarchy, density, rhythm, legibility, state clarity, and workstation character. A visually attractive screenshot cannot waive a failed oracle or metric.

A criterion is complete only when every listed evidence type passes. Existing tests must not be weakened to make redesigned markup pass.

## Behavior acceptance

| ID | Criterion | Evidence and mapping |
|---|---|---|
| A-BEH-01 | `SourceDocument.document` remains the only canonical editing state; canvas and inspector stay synchronized derivatives. | Behavior oracle: current model/editor unit tests and `npm test`; browser sequence S-01. |
| A-BEH-02 | Standard HTML/SVG serialization, stable `data-editor-id`, selection identity, history, and export round-trip remain unchanged. | Behavior oracle: existing serialization/history/export tests and browser smoke; S-01, S-07. |
| A-BEH-03 | Imported scripts, inline event handlers, and untrusted local commands are not executed. | Behavior oracle: existing sanitization/import tests; security assertions remain intact. |
| A-BEH-04 | Switching Layers, Pages, or Fragments context does not change the document, selection, history, viewport-authored geometry, or unsaved field values. | New focused UI test plus S-02/S-03/S-05. |
| A-BEH-05 | Page select, thumbnail select, previous/next, duplicate, reorder, delete, and persisted active page keep current semantics. | Existing page/browser tests plus S-03. |
| A-BEH-06 | Build assignment, grouping, reorder, playback previous/next, view mode, and preview behavior remain correct. | Existing build/presentation tests plus S-04/S-06. |
| A-BEH-07 | Fragment save, clipboard, local library, filter, insertion, dependency report, and storage behavior remain correct. | Existing fragment tests plus S-05. |
| A-BEH-08 | Source drawer starts collapsed, collapsed height is ≤44 px, toggle text remains `展开源码` / `收起源码`, and Apply remains explicit. | Browser smoke plus S-07; structural metric on initial and expanded state. |
| A-BEH-09 | Resizers work by pointer and keyboard; collapsed widths/heights and preferences survive reload. | Existing layout tests plus S-08; storage migration test if schema changes. |
| A-BEH-10 | App-shell viewport changes do not mutate authored canvas size, coordinates, typography, transforms, or serialized source. | Canvas gate at all three viewports; before/after serialized document equality in S-09. |

## Structural acceptance

| ID | Measurable criterion | Required state(s) |
|---|---|---|
| A-STR-01 | Zero duplicate visible IDs and zero missing protected IDs/hooks for existing features. | Every audit scenario at all viewports. |
| A-STR-02 | Every visible input, select, textarea, button, summary action, and icon-only control has a unique accessible name. | Default, selected, deck, SVG, source, fragments, preview. |
| A-STR-03 | Standard controls are 28–32 px high; every icon-button hit area is at least 28×28 px. | All permanent and transient surfaces. |
| A-STR-04 | Interactive text is at least 12 px; helper/metadata is at least 11 px; code is at least 12 px. | Computed-style audit across all scenarios. |
| A-STR-05 | Normal text contrast is at least 4.5:1; meaningful non-text UI boundaries/focus are at least 3:1. | Token test plus representative computed-style/contrast audit. |
| A-STR-06 | No app-shell horizontal scrolling and no essential control clipped outside the viewport. | All scenarios at 1280×800, 1440×900, 1920×1080. |
| A-STR-07 | Canvas viewport remains at least 360×220 px at compact desktop, including expanded source and deck/selection contexts. | Compact source, deck, selected states. |
| A-STR-08 | Permanent panel sizing matches target defaults within ±2 px: rail 42, left 216/240/280, right 272/288/320, source collapsed 40. | Default at each target viewport. |
| A-STR-09 | Focus-visible is perceptible on every interactive class, including rail items, tree rows, resizers, canvas, toolbar, inspector, source, and dialogs. | Keyboard traversal screenshots and CSS/state audit. |
| A-STR-10 | Reduced-motion mode removes nonessential animation; no layout-affecting animation is introduced. | Browser context with `reducedMotion: reduce`; CSS audit. |
| A-STR-11 | No browser page, console, or request error is introduced. | Every browser scenario and release gate. |
| A-STR-12 | Status updates use a documented live-region policy and do not announce continuously during pointer movement/resizing. | Accessibility tree inspection plus S-01/S-08. |
| A-STR-13 | Dialogs remain within viewport, contain overscroll, close appropriately, and return focus to their trigger. | Paste, fragment, preview-choice, presentation, report dialogs. |
| A-STR-14 | Layout preference changes preserve or migrate `last-mile-studio:layout:v1`; no silent reset. | Reload/migration test. |

## Visual acceptance

| ID | Judgment criterion | Failure examples |
|---|---|---|
| A-VIS-01 | Canvas is the dominant visual region at every target viewport. | Permanent panels expand to fill wide space; Pages/source unnecessarily consume canvas height. |
| A-VIS-02 | Global, mode, and selection commands are visually distinct without duplication. | Page management in two permanent places; Build authoring in center and inspector; selection tools always visible. |
| A-VIS-03 | Layers, Pages, and Fragments read as destinations in one navigation system; unsupported capabilities are absent. | Fake History/cloud/account destinations; ambiguous icons without labels/tooltips. |
| A-VIS-04 | Inspector communicates Design, Build, and Advanced hierarchy and keeps common properties above advanced fields. | One undifferentiated form stream; Build permanently dominates non-deck selection. |
| A-VIS-05 | Dense controls remain readable and aligned; no 7–10 px text is used to force fit. | Truncated labels, compressed 20 px action rows, low-contrast metadata. |
| A-VIS-06 | Surfaces are restrained neutral dark with one functional blue accent. | Decorative gradients, neon glow, glass panels, large permanent shadows, ornamental cards. |
| A-VIS-07 | Focus, hover, selected, disabled, loading, success, warning, error, and empty states are distinguishable and consistent. | Color-only selection; disabled text becomes illegible; empty dialog offers no next step. |
| A-VIS-08 | Wide layouts give additional room to the canvas rather than inflating panels, spacing, or typography. | Controls spread across unused top-bar width or inspectors grow without bound. |

## Required screenshot matrix

Capture PNGs after each relevant phase using deterministic sample data, cleared local/session storage, dark color scheme, `zh-CN`, and reduced motion. Before/after files must use the same viewport and scenario.

| Scenario | 1280×800 | 1440×900 | 1920×1080 | Required review |
|---|---:|---:|---:|---|
| Default HTML | Yes | Yes | Yes | Global hierarchy, canvas dominance, no empty chrome inflation |
| Selected HTML element | Yes | Yes | Yes | Selection strip, Design inspector, labels, focus |
| Multi-page deck | Yes | Yes | Yes | Pages context, Build availability, no toolbar overflow |
| Deck with left context collapsed | Yes | Yes | Yes | Canvas recovery and compact mode controls |
| SVG selection | Yes | Yes | Yes | Document-kind controls and color/input labels |
| Source expanded | Yes | Yes | Yes | Explicit Apply, code size, minimum canvas area |
| Fragment library | Yes | Yes | Yes | Density, empty/filter states, dialog focus |
| Preview choice | Yes | Yes | Yes | Dialog hierarchy and focus |
| Presentation open | Yes | Yes | Yes | Actual `#presentation-dialog[open]`, not only preview choice |
| Keyboard focus sequence | Yes | Yes | Yes | Visible focus across rail/tree/canvas/inspector/source |

Screenshot filenames should remain deterministic, for example `compact__deck.png`, and the report must link every required path.

## Required interaction sequences

### S-01 — select, edit, source sync, undo/redo

1. Load the HTML example.
2. Select an element from the canvas, then from Layers.
3. Change one geometry value and one appearance value.
4. Confirm canvas and source synchronization and one history boundary.
5. Undo and redo by keyboard.
6. Confirm `#document-status`, `#selection-status`, and `#sync-status` are accurate and appropriately announced.

Passes A-BEH-01, A-BEH-02, A-STR-02, A-STR-12.

### S-02 — keyboard-only layer tree

1. Focus the Layers rail destination and tree.
2. Use Arrow/Home/End to navigate, Left/Right to collapse/expand or move hierarchy focus, Enter/Space to select, and F2 to rename.
3. Reorder or reparent using the documented keyboard alternative.
4. Confirm focus remains visible, canvas selection follows, and the result is announced.

Passes A-BEH-04, A-STR-03, A-STR-09.

### S-03 — pages context

1. Load the deck example and open Pages from the rail.
2. Select via thumbnail, use previous/next, duplicate, reorder, and delete with confirmation semantics.
3. Collapse/reopen the left panel and reload.
4. Confirm active page, page order, selection, and authored geometry remain correct.

Passes A-BEH-04, A-BEH-05, A-BEH-09, A-BEH-10.

### S-04 — Build authoring and playback

1. Select an element and assign it to a Build group in the right inspector.
2. Reorder groups/elements and inspect warnings.
3. Switch playback/group/all view modes; use previous/next by pointer and keyboard.
4. Confirm the center shows playback only and does not duplicate authoring controls.

Passes A-BEH-06, A-VIS-02, A-VIS-04.

### S-05 — fragments

1. Save selection as a fragment; cancel once and confirm focus return.
2. Open the temporary clipboard and local library from Fragments.
3. Filter/search, favorite if supported, inspect dependency report, and insert.
4. Confirm source sanitization, identity, storage, empty/error/loading states, and keyboard operation.

Passes A-BEH-03, A-BEH-04, A-BEH-07, A-STR-13.

### S-06 — presentation preview

1. Activate `#preview-presentation`.
2. Confirm `#preview-choice-dialog` opens and focus enters it.
3. Choose start/current; confirm `#presentation-dialog[open]` and capture it.
4. Close with the control and Escape where safe; confirm focus returns to Preview.

Passes A-BEH-06, A-STR-13 and prevents the baseline harness mismatch.

### S-07 — source-first workflow

1. Confirm the drawer starts collapsed at ≤44 px and says `展开源码`.
2. Expand; locate selection, search, format, introduce a valid edit, and apply explicitly.
3. Confirm dirty/error/synced states, canvas update, and history behavior.
4. Collapse and confirm canvas height is reclaimed and label changes to `收起源码` only while expanded.

Passes A-BEH-01, A-BEH-08, A-STR-07.

### S-08 — layout persistence and resizers

1. Resize left, right, and applicable horizontal regions by pointer.
2. Resize each separator by keyboard with normal and Shift steps.
3. Collapse/reopen panels and reload.
4. Confirm persisted state, `aria-valuenow/min/max`, focus visibility, and canvas recovery.

Passes A-BEH-09, A-STR-09, A-STR-14.

### S-09 — viewport invariance

1. Record canonical source and authored canvas/page dimensions at 1440×900.
2. Repeat at 1280×800 and 1920×1080, including collapsed panels and expanded source.
3. Compare serialized source, coordinates, dimensions, font sizes, and transforms.
4. Accept shell reflow only; reject any authored-document mutation.

Passes A-BEH-10, A-STR-06, A-STR-07, A-VIS-01, A-VIS-08.

## Criterion-to-gate mapping

| Gate | Primary coverage |
|---|---|
| `bash scripts/ui-gate.sh fast` | Typecheck, unit behavior oracle, fast structural/visual smoke |
| `bash scripts/ui-gate.sh checkpoint` | Full phase browser checkpoint and required screenshots |
| `bash scripts/ui-gate.sh canvas` | Canvas/page/layout/viewport invariance after relevant phases |
| `bash scripts/ui-gate.sh release` | Complete oracle, structural metrics, screenshots, runtime error audit |
| `git diff --check` | Patch hygiene only; it does not prove product acceptance |

## Release decision rule

The redesign is complete only when:

- every applicable A-BEH criterion passes without weakened assertions;
- every A-STR criterion passes at all three target viewports;
- human review accepts every A-VIS criterion and screenshot;
- no P0/P1 finding remains open;
- P2 deferrals have an explicit owner and rationale;
- protected selectors, hooks, storage, security boundaries, and source-first architecture are verified;
- the final diff contains no unrelated cleanup.

If the same repair fails twice, revert the smallest failed patch, reduce the phase scope, and report the blocker. Do not solve a failed acceptance criterion by relaxing the criterion or audit.
