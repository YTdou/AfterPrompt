# Last Mile Studio UI Design System

Status: design contract for future phases; not an implementation

Product posture: precision creative workstation

Variance: low

Motion: low

Density: high, readable, and keyboard-accessible

## Design thesis

Last Mile Studio should feel like an instrument for exact work: canvas first, source always authoritative, context close to the object being edited, and global actions visually separate from local operations. The system borrows the discipline of Figma, Framer, VS Code, and Linear without imitating any one product.

The UI is not a dashboard. It does not need decorative cards, a marketing hero, cloud/account chrome, or speculative collaboration features. Surface differences, one-pixel borders, precise alignment, and a single functional accent should do nearly all of the visual work.

The canonical state remains `SourceDocument.document`. The canvas remains a sanitized derivative of standard HTML/SVG. UI organization may change; serialization, stable `data-editor-id`, selection semantics, history, export, fragment storage, and source synchronization may not change without a separate product-contract phase.

## Information architecture

### Activity rail decision

An activity rail is justified, but only by existing capabilities. Use a 40–42 px rail with three destinations:

1. **Layers** — structure tree and layer operations.
2. **Pages** — shown or enabled when the document has multi-page capability; thumbnails and page management.
3. **Fragments** — temporary clipboard and local-library entry points, search/filter, and insertion workflow.

Do not add History, Search, Assets, cloud sync, collaboration, account, or settings destinations unless a real corresponding product surface exists. Undo/redo is not a History panel. “Fragments” may use the accessible label “片段与资源,” but it must not imply a general asset system the product does not support.

The rail selects the content of one left contextual panel. It is navigation, not a second model: panels read and mutate the canonical document through existing commands.

### Region responsibilities

| Region | Owns | Must not own |
|---|---|---|
| Top bar | Identity, import/open, undo/redo, preview, export | Selection properties, canvas geometry, page/build authoring |
| Activity rail | Switch among Layers, Pages, Fragments | Unsupported destinations or document mutations by itself |
| Left contextual panel | One navigation/management context at a time | Duplicated inspector controls |
| Canvas context bar | Current mode, compact page/build playback, canvas size/zoom; selection strip when applicable | Full page management or build authoring |
| Canvas | Sanitized visual derivative and direct manipulation | Private UI source of truth |
| Right inspector | Design, Build, Advanced contextual editing | Global import/export or duplicate page navigation |
| Bottom status | Document, selection, synchronization state | Primary actions |
| Source drawer | Locate/search/format/apply canonical source | Auto-apply without explicit boundary |
| Dialogs/popovers | Short, interruptive, task-bounded workflows | Permanent navigation or repeated core controls |

### Coexistence of Pages, Layers, Build, Inspector, Fragments, and Source

- **Layers, Pages, and Fragments** are mutually exclusive left-panel contexts selected by the activity rail.
- **Pages** owns thumbnails, duplicate, reorder, and delete. Preserve `#page-filmstrip` and `#page-thumbnails`, but the surface may be visually relocated into the left context. The center retains only previous/current/next when multi-page navigation is relevant.
- **Build** is not a rail destination. Build authoring belongs to the right inspector's Build grouping because it is page/selection contextual. The center retains only previous state, current state, next state, and view mode for playback.
- **Inspector** is the right-side container, not a duplicate destination. It contains Design, Build, and Advanced groupings.
- **Fragments** owns discovery/insertion in the left context. Save-selection and dependency/report flows may remain dialogs because they are bounded transactions.
- **Source** remains a bottom drawer, collapsed by default. It is neither a rail destination nor a permanent competing editor pane.

### Command scope

| Scope | Controls |
|---|---|
| Global | Import/open, undo, redo, preview, export |
| Mode-specific | Page previous/current/next, build playback, canvas preset/size, zoom/fit |
| Selection-specific | Align/distribute, geometry, typography, appearance, lock/visibility/z-order, fragment save |
| Document-kind-specific | HTML/SVG export label, page/build/presentation availability, SVG-only properties, HTML-only presentation controls |

Selection-specific alignment appears as a compact contextual strip only while selection exists. Document-kind-specific controls disappear when inapplicable rather than staying disabled without explanation.

## Visual tokens

Token names are semantic. Values are the target starting point and may be tuned only when contrast and screenshot evidence support the change.

### Surface and color

| Token | Value | Use |
|---|---|---|
| `--surface-canvas-shell` | `#0b0d12` | App background and deepest shell |
| `--surface-panel` | `#11141b` | Permanent panels and top bar |
| `--surface-raised` | `#171b24` | Controls, grouped rows, menus |
| `--surface-active` | `#202633` | Hover/active/selected neutral surface |
| `--border-subtle` | `#292f3c` | Permanent separators |
| `--border-strong` | `#3a4353` | Focus-adjacent boundaries, active group edges |
| `--text-primary` | `#e8edf7` | Primary text |
| `--text-secondary` | `#b8c2d2` | Labels and secondary values |
| `--text-muted` | `#8c96a8` | Helper text |
| `--text-subdued` | `#8792a5` | Lowest permitted permanent text color |
| `--accent` | `#5b8cff` | Selection, focus, active state, primary action |
| `--accent-strong` | `#78a2ff` | Accent text/hover on dark surfaces |
| `--success` | `#5fd7a0` | Confirmed synchronized/success state |
| `--warning` | `#e7cb83` | Non-destructive warning |
| `--danger` | `#ff6e78` | Destructive/error state |

Accent is functional, never decorative. No accent gradients. Text and icons must meet 4.5:1 for normal text and 3:1 for large text or meaningful non-text UI boundaries. `--text-subdued` is the floor, not a default.

### Typography

Use the existing local/system sans stack and monospace stack; add no font dependency.

| Role | Size / line height | Weight |
|---|---|---:|
| Application title | 16 / 20 px | 600 |
| Panel/section title | 14 / 18 px | 600 |
| Standard UI/control | 12–13 / 16–18 px | 450–550 |
| Helper/metadata | 11 / 14 px minimum | 400–500 |
| Code | 12 / 18 px minimum | 400 |

Uppercase eyebrows are optional, never below 11 px, and should be used only when they clarify hierarchy. Do not use letter spacing to compensate for illegibly small type.

### Spacing

Base sequence: `4, 8, 12, 16, 20, 24` px.

- 4 px: icon/text internal gap, tightly related metadata.
- 8 px: control gap and compact row padding.
- 12 px: group padding and standard vertical rhythm.
- 16 px: panel section separation.
- 20–24 px: dialog and empty-state composition.

### Radius

- 4 px: inputs, buttons, compact rows.
- 6 px: menus, groups, popovers.
- 8 px: dialogs and exceptional floating surfaces.

No larger radius on permanent surfaces.

### Elevation

Permanent panels use surface value plus a 1 px border and no shadow. Menus/popovers use one restrained shadow; dialogs may use the strongest elevation. Canvas selection shadows belong to authored/selection feedback, not shell decoration.

Suggested tokens:

- `--shadow-popover: 0 8px 24px rgb(0 0 0 / 0.32)`
- `--shadow-dialog: 0 18px 48px rgb(0 0 0 / 0.42)`

### Motion

| Token | Duration | Use |
|---|---:|---|
| `--motion-fast` | 120 ms | Hover/focus color and opacity |
| `--motion-standard` | 160 ms | Panel disclosure and small state transition |
| `--motion-emphasis` | 180 ms | Dialog/popover entry |

Animate only opacity, transform, and color where possible. Resizing and authored geometry update directly. Under `prefers-reduced-motion: reduce`, nonessential animation duration becomes zero and canvas/layer auto-scroll avoids smooth behavior.

## Layout tokens and desktop behavior

| Viewport | Top bar | Rail | Left panel | Right inspector | Source collapsed | Intended center width |
|---|---:|---:|---:|---:|---:|---:|
| 1280×800 | 48 px | 42 px | 216 px | 272 px | 40 px | ~748 px before borders |
| 1440×900 | 48 px | 42 px | 240 px | 288 px | 40 px | ~868 px before borders |
| 1920×1080 | 48 px | 42 px | 280 px | 320 px | 40 px | ~1276 px before borders |

The left and right panels remain resizable and collapsible. Existing minimum canvas guarantees remain: the application shell may reflow or collapse, but it must not mutate authored width, height, coordinates, font size, or transforms.

### 1280×800 compact desktop

- Global actions remain visible.
- Left context defaults to 216 px and inspector to 272 px.
- The center uses one compact mode row. Canvas dimensions may collapse into a labeled popover; zoom/fit remains visible.
- Selection alignment appears in a second contextual row or a contained overflow menu; it must not create document-level horizontal scrolling.
- Pages are vertical in the left panel. No horizontal filmstrip consumes canvas height.
- Inspector sections use disclosure; Advanced starts collapsed.
- Expanded source height is `clamp(240px, 32vh, 360px)` and preserves at least a 360×220 px usable canvas viewport.

### 1440×900 standard desktop

- Left context is 240 px, inspector 288 px.
- Page/build playback and zoom fit on the mode row; selection operations use a contextual strip.
- Design is initially open, Build appears for capable HTML/deck documents, and Advanced is collapsed.
- No control intersects, clips, or causes shell-level horizontal overflow in any required scenario.

### 1920×1080 wide desktop

- Left context is 280 px, inspector 320 px.
- Extra space belongs to the canvas, not to larger permanent panels or inflated controls.
- The top bar retains grouped global actions; it does not spread controls across the full width merely to fill space.
- Inspector may show more groups simultaneously, but control sizes and typography do not scale up.

## Control specifications

### Buttons

- Standard height: 30 px; compact dense height: 28 px.
- Horizontal padding: 8–10 px.
- Icon-only: at least 28×28 px, 16×16 px icon, accessible name, native tooltip or consistent local tooltip.
- Primary styling is reserved for Import/open entry, Export, Apply source, and the affirmative action in a modal. A surface must not contain multiple visually equal primary actions.
- Destructive actions use danger color only at the decision point and require appropriate confirmation when irreversible.

### Inputs, selects, and textareas

- Height: 30 px for one-line controls.
- Text: 12 px minimum; labels remain visible and programmatically associated.
- Units appear as adjacent text or input adornments, never placeholder-only.
- Color inputs and their textual values each receive an explicit unique label.
- Invalid state uses border plus text/icon; color alone is insufficient.

### Segmented controls and tabs

Use for mutually exclusive modes such as playback/group/all, not for unrelated actions. Apply `aria-pressed` or tab semantics as appropriate. Changing inspector group visibility must not reset pending values, selection, scroll position without intent, or canonical source state.

### Tree and list rows

- Row height: 28–32 px.
- Layer tree implements roving tabindex and documented Arrow/Home/End/Left/Right/Enter/Space/F2 behavior.
- Drag remains available, but reorder/reparent needs a complete keyboard command path and announced result.
- Selected, focused, locked, hidden, and drop-target states remain distinguishable without color alone.

### Resizers

Preserve semantic separator roles, orientation, `tabindex="0"`, value attributes, pointer dragging, and Arrow-key resizing. The visible affordance may be narrow, but the interactive hit target must be at least 8 px across and must show `:focus-visible`.

### Menus, popovers, and dialogs

- Menus remain attached to their trigger and stay within the viewport.
- Dialogs constrain overscroll, expose a visible title, close by Escape when safe, and return focus to the opener.
- Long content scrolls inside the dialog, not behind it.
- Empty states explain what is empty and offer one relevant next action.

## Interaction state system

| State | Contract |
|---|---|
| Default | Clear label, sufficient contrast, no unnecessary border emphasis |
| Hover | Subtle raised-surface or text change; no layout movement |
| Focus | 2 px accent ring with 2 px offset or equivalent inset/outset treatment; always visible under `:focus-visible` |
| Active/selected | Accent edge/fill plus a second cue such as icon/check/weight |
| Disabled | Reduced emphasis while remaining legible; native semantics and explanation when needed |
| Loading | Preserve dimensions; show localized progress; do not block unrelated editor work |
| Success/synced | Short, calm status; announce only meaningful transitions |
| Error | Explain cause and recovery next to the affected control; preserve user input |
| Empty | State what is absent and the single most relevant action; no decorative illustration required |

## Icon policy

- Use a small local inline-SVG helper or shared SVG symbol set; no production dependency.
- Standard icon canvas is 16×16 with consistent 1.5 px stroke, rounded caps/joins where appropriate.
- Icons inherit `currentColor`.
- Unicode glyphs must not be the sole meaning of an action.
- Every icon-only control has an accessible name and tooltip.
- Do not mix filled, outlined, emoji, and text-symbol styles within one command family.

## Current-to-proposed region mapping

| Current region | Proposed region | Preservation rule |
|---|---|---|
| `.topbar` | Global top bar | Keep global IDs and document-kind labels |
| `#layers-panel` | Rail + left contextual container, Layers view | Keep panel/tree/data hooks; do not create a second tree model |
| `#page-filmstrip` / `#page-thumbnails` | Left contextual Pages view | Preserve IDs and page behavior while changing visual placement |
| Fragment menu/dialog entry points | Left Fragments view plus bounded dialogs | Preserve fragment IDs, storage, and insertion behavior |
| `.canvas-toolbar` | Mode row + conditional selection strip | Preserve commands; reorganize by scope |
| `#build-control` | Compact canvas playback group | Preserve ID and keyboard shortcuts |
| `#build-panel` | Right inspector Build grouping | Preserve ID and build semantics |
| `#inspector-content` | Right inspector Design and Advanced groupings | Preserve generated field hooks and source synchronization |
| `.canvas-status` | Compact bottom status bar | Preserve three status IDs and add announcement policy |
| `#code-drawer` | Bottom source drawer | Start collapsed, at most 44 px, preserve toggle text and explicit Apply |
| Import/export/fragment/presentation dialogs | Task-bounded overlays | Preserve IDs, security boundary, focus contract, and automation hooks |

## Anti-patterns to avoid

- No framework migration, Tailwind introduction, or new production dependency.
- No private UI document model or viewport-derived authored geometry.
- No glassmorphism, neon/cyberpunk palette, decorative blue-purple gradient, or canvas-external grid decoration.
- No oversized radius, permanent-panel shadow, ornamental card around every setting, or whitespace inflation at the cost of density.
- No hover-only essential action, mystery icon, unlabeled input, or tiny text used to make a crowded layout “fit.”
- No activity-rail destination for unsupported capability.
- No duplicated permanent control merely because space exists.
- No test weakening, selector churn, or storage reset to accommodate markup changes.
- No auto-application of source edits and no imported script/event-handler execution.
