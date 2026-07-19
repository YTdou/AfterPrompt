# Codex task: Phase 1 — UI foundation and application shell

Repository: `drinkle-T/HTML-editor`
Required branch: `codex/self-check-20260718`

Read `AGENTS.md` and all approved documents under `docs/ui/`. Implement only the first approved migration phase: design tokens, typography, shared control styling, focus treatment, top bar, workspace shell, and permanent panel separation.

Use the installed skills:

1. UI UX Pro Max to consult the approved system, not to replace it.
2. Impeccable to critique the proposed shell before and after coding.
3. Web Design Guidelines after implementation.

Before editing:

- run `bash scripts/ui-gate.sh fast`;
- capture the default, selected, and deck baseline at 1440×900;
- list the exact files to change;
- list protected selectors and behaviors;
- state what is out of scope.

Implementation constraints:

- preserve the vanilla TypeScript/Vite architecture;
- add no production dependency;
- preserve all existing IDs and `data-*` hooks;
- preserve import/export behavior, undo/redo, preview, panel resizing, source-drawer default collapse, and source toggle labels;
- do not redesign layer rows, page thumbnails, inspector internals, fragment dialogs, or CodeMirror in this phase;
- prefer semantic CSS tokens over ad hoc colors;
- remove decorative gradient/glass/heavy-shadow styling from the permanent shell;
- raise normal interactive typography to the approved minimum;
- keep the diff coherent and bounded.

After implementation:

1. Run `bash scripts/ui-gate.sh fast`.
2. Run `bash scripts/ui-gate.sh checkpoint`.
3. Capture compact, standard, and wide screenshots.
4. Run an Impeccable critique and a Web Design Guidelines audit on changed files.
5. Fix P0/P1 findings within this phase only.
6. Re-run the checkpoint gate.
7. Report changed files, tests, screenshots, resolved findings, deferred P2 items, and any contract-preserving compromises.
