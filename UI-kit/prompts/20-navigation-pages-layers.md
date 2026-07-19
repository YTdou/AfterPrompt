# Codex task: Phase 2 — navigation, pages, layers, and layout behavior

Repository: `drinkle-T/HTML-editor`
Required branch: `codex/self-check-20260718`

Implement only the approved navigation/pages/layers phase from `docs/ui/UI_MIGRATION_PLAN.md`.

Primary goal:

- make navigation among existing Pages, Layers, and Fragments/Assets contexts clearer;
- preserve maximum usable canvas space;
- improve layer-row readability, selected/hover/drag states, page-thumbnail hierarchy, panel headings, and action grouping;
- implement an activity rail only if it was approved in the design docs and can be mapped to existing features without inventing destinations.

Protected behavior:

- page selection, duplication, deletion, forward/backward movement, and drag ordering;
- build count badges and final-build thumbnails;
- layer selection, additive selection, automatic ancestor expansion/centering, F2 rename, disclosure, visibility, lock, order, drag/reparent feedback;
- pointer and keyboard resizing;
- collapsed layout persistence;
- minimum canvas width;
- all existing automation hooks.

Do not touch:

- canonical document commands;
- transform semantics;
- fragment storage semantics;
- inspector field behavior;
- export serialization.

Workflow:

1. Run the fast gate and capture baseline screenshots.
2. Use Impeccable to audit the exact navigation scope.
3. State the DOM/state mapping before editing.
4. Implement one coherent sub-surface at a time. Split activity-rail work from layer/page polish if the combined diff would exceed the bounded phase.
5. Do not weaken browser-smoke selectors. Keep stable hooks on moved elements.
6. Run `bash scripts/ui-gate.sh checkpoint`.
7. Because layout changes can affect canvas geometry, also run `bash scripts/ui-gate.sh canvas`.
8. Capture compact, standard, wide, collapsed-panels, and deck screenshots.
9. Use Web Design Guidelines to review keyboard resizing, focus order, labels, and disclosure semantics.
10. Fix P0/P1 findings and rerun the canvas gate.

Return an evidence-based summary, not a subjective “looks better” claim.
