# Codex task: Phase 3 — contextual canvas toolbar and inspector hierarchy

Repository: `drinkle-T/HTML-editor`
Required branch: `codex/self-check-20260718`

Implement only the approved canvas-toolbar/status/inspector phase.

Goals:

- separate no-selection, single-selection, multi-selection, page, and build controls;
- keep zoom, fit, canvas size, page state, build state, and alignment discoverable without presenting every command at all times;
- organize the inspector into the approved Design / Build / Advanced hierarchy;
- eliminate duplicated permanent controls while keeping every existing command reachable;
- improve field labeling, numeric readability, color controls, shadow controls, validation feedback, empty selection, and multi-selection states.

Hard constraints:

- no changes to `SourceDocument` truth ownership;
- no changes to transform math, authored bounds, build semantics, history semantics, or code synchronization;
- do not hide a command behind hover-only UI;
- tabs/accordions must preserve current selection and unsaved field values;
- all existing IDs used by behavior and browser smoke remain available;
- canvas viewport must not shrink below the current minimum because of new chrome;
- authored layout remains viewport invariant.

Required verification:

1. Fast gate before editing.
2. Baseline screenshots for no selection, selected HTML, multi-selection, deck/build, and SVG.
3. Impeccable pre-implementation critique.
4. Bounded implementation.
5. `bash scripts/ui-gate.sh canvas`.
6. Real interaction checks for:
   - single → group → single selection cycles;
   - actual group drag;
   - undo/redo;
   - page and build navigation;
   - inspector field edit;
   - code sync state;
   - zoom/fit and panel collapse.
7. Web Design Guidelines audit.
8. Fix P0/P1 findings.
9. Re-run the canvas gate and capture all target viewport screenshots.

Report exact behavior evidence and any deliberately deferred inspector restructuring.
