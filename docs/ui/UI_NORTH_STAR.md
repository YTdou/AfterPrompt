# Last Mile Studio UI North Star

## Product character

Last Mile Studio is a source-first visual editor for AI-generated HTML, HTML presentations, and SVG. It is a professional creation tool. Its shell should optimize repeated editing, inspection, and export work rather than look like a consumer landing page.

Design phrase:

> Precision Creative Workstation

Primary qualities:

- trustworthy;
- technical but approachable;
- dense but readable;
- quiet until state or risk requires attention;
- canvas-centered;
- keyboard-friendly;
- consistent across HTML, deck, SVG, source, build, and fragment workflows.

## Core user jobs

1. Import or paste source and immediately understand document state.
2. Navigate pages, builds, layers, and selections without losing canvas space.
3. Modify geometry and style precisely.
4. Inspect source and apply code without corrupting the previous valid canvas.
5. Reuse fragments/components while understanding storage and compatibility.
6. Preview and export with confidence.

## Hierarchy

### Global layer

The top bar contains only document/global actions:

- product/document identity;
- import;
- undo/redo;
- presentation preview when relevant;
- export.

### Navigation layer

A narrow activity rail may switch among existing major contexts such as Pages, Layers, and Fragments. It must not expose a destination that lacks a real implementation.

The adjacent contextual panel contains the current navigation surface and remains resizable/collapsible.

### Canvas layer

The canvas owns:

- selection-specific actions;
- page/build playback state;
- canvas dimensions;
- zoom/fit;
- authored document;
- compact status.

Permanent toolbar content should be grouped by mode. Controls that are meaningless without a selection should not dominate the empty-selection state.

### Inspector layer

Group existing properties by task:

- Design: geometry, type, fill, stroke, appearance.
- Build: build assignment and sequence when applicable.
- Advanced: class, inline style, IDs, linked-fragment metadata where existing behavior supports it.

Tabs or accordions must not destroy entered values or selection state.

### Source layer

The source drawer remains collapsed by default. Expanded source actions remain clear and preserve the explicit “apply valid code” boundary.

## Visual language

### Surfaces

Use neutral charcoal surfaces with small, intentional luminance steps. The canvas is the strongest visual contrast. Permanent panels use borders, not floating-card shadows.

### Typography

- Product/UI: system sans or approved local stack.
- Code/IDs/numbers: JetBrains Mono or the existing monospace stack.
- UI body: 12–13 px.
- Metadata/helper: 11 px minimum.
- Headings: compact; no marketing-scale typography.

### Spacing

Base spacing rhythm: 4 px.

Common values: 4, 8, 12, 16, 20, 24.

Use density to support work, not to justify unreadable controls.

### State

- Accent: focus, selection, active, primary action.
- Success: completed sync/safe state.
- Warning: actionable compatibility or validation issue.
- Danger: destructive actions and hard errors.
- Disabled: reduced emphasis while preserving label readability.

### Motion

Use 120–180 ms transitions for hover, focus, disclosure, and panel state. Disable nonessential motion under `prefers-reduced-motion`.

## Acceptance targets

At 1280×800, 1440×900, and 1920×1080:

- no document-level horizontal overflow;
- global import/export actions remain visible;
- canvas viewport remains usable;
- primary panel controls are not clipped;
- no visible interactive control has an unnamed accessible action;
- control targets are at least 24 px high, with 28 px preferred;
- normal interactive text is at least 11 px;
- focus state is visible;
- default, selected element, deck, SVG, source-expanded, panel-collapsed, and fragment-library states have screenshots;
- all repository behavior gates pass.
