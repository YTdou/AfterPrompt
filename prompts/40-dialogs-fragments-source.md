# Codex task: Phase 4 — menus, dialogs, fragment workspace, and source drawer

Repository: `drinkle-T/HTML-editor`
Required branch: `main`

Implement only the approved menu/dialog/fragment/source phase.

Goals:

- make import/export menus scannable and keyboard-clear;
- unify dialog headers, content density, footers, destructive actions, empty/loading/error states, and close behavior;
- improve the fragment save, library, storage, compatibility, property, and slot surfaces without changing their data semantics;
- visually integrate CodeMirror and the source drawer with the new shell while preserving the explicit “draft until Apply Code” contract.

Protected behavior:

- exact import/export capabilities and dynamic document export label;
- native dialog semantics and all existing dialog IDs;
- local directory as long-term fragment source;
- IndexedDB as temporary application clipboard;
- rapid Ctrl/Cmd+C then Ctrl/Cmd+V ordering;
- invocation-time selection/page context;
- 16 px repeated-paste offset;
- compatibility plan before apply;
- source parse failure keeps the previous valid canvas;
- source drawer starts collapsed, stays at most 44 px collapsed, and exposes only the expected collapsed action;
- native textarea and CodeMirror clipboard isolation.

Process:

1. Run the fast gate.
2. Capture import, export, source-expanded, fragment-library, fragment-save, and compatibility-report baselines.
3. Use Impeccable to identify hierarchy and density issues in this scope.
4. Implement without changing storage or command logic unless a demonstrated UI bug requires it.
5. Run the checkpoint gate.
6. Run the browser smoke and explicitly verify the rapid clipboard sequences.
7. Run Web Design Guidelines on menus, dialogs, forms, focus, labels, and error communication.
8. Fix P0/P1 findings.
9. Re-run the checkpoint and capture target viewport screenshots.

Do not convert the fragment library into a card-heavy marketplace aesthetic. It is a local professional asset manager.
