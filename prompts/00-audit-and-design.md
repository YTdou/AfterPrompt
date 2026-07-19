# Codex task: UI audit and design contract — no application-code changes

Repository: `drinkle-T/HTML-editor`
Required branch: `main`

Act as the lead product designer and frontend architect for Last Mile Studio. This task is analysis and design documentation only. Do not modify application source, tests, package dependencies, or runtime behavior.

First:

1. Verify the branch, worktree status, Node version, and installed skills.
2. Read `AGENTS.md`, `docs/ui/UI_NORTH_STAR.md`, `README.md`, `docs/ARCHITECTURE.md`, both self-check campaign reports, `package.json`, the main UI files, `src/styles.css`, and `scripts/browser-smoke.mjs`.
3. Run the current fast gate. If the harness files have not been installed yet, run `npm run typecheck`, `npm test`, and `git diff --check`.
4. Launch the app and capture baseline states at 1280×800, 1440×900, and 1920×1080.

Use the installed skills explicitly:

- UI UX Pro Max for a coherent design-system proposal with low variance, low motion, and high density.
- Impeccable for information architecture, hierarchy, cognitive-load, and consistency critique.
- Web Design Guidelines for accessibility and interaction risks.

Create these documents:

1. `docs/ui/UI_BASELINE.md`
   - current surface inventory;
   - primary user workflows;
   - hierarchy and density defects;
   - accessibility/keyboard defects;
   - responsive/clipping defects;
   - P0/P1/P2 findings with exact files/selectors;
   - screenshot index.

2. `docs/ui/UI_DESIGN_SYSTEM.md`
   - design thesis;
   - information architecture;
   - surface/color/type/spacing/radius/elevation/motion tokens;
   - control specifications;
   - icon policy;
   - focus, hover, active, disabled, loading, error, empty states;
   - exact desktop behavior at all three target viewports;
   - mapping from current UI regions to proposed regions;
   - anti-patterns to avoid.

3. `docs/ui/UI_MIGRATION_PLAN.md`
   - 5–7 independently reviewable phases;
   - each phase limited to one coherent surface;
   - expected files and approximate diff size;
   - protected selectors/behaviors;
   - required test gate;
   - rollback boundary;
   - no framework migration and no new production dependencies.

4. `docs/ui/UI_ACCEPTANCE.md`
   - measurable acceptance criteria;
   - criterion-to-test mapping;
   - required screenshots and interaction sequences;
   - explicit distinction among behavior oracle, structural metric, and visual judgment.

Required decisions:

- Decide whether an activity rail is justified by existing product capabilities.
- Decide how Pages, Layers, Build, Inspector, Fragments, and Source should coexist without duplicating controls.
- Decide which controls are global, mode-specific, selection-specific, and document-kind-specific.
- Identify every existing 8–10 px interactive text usage that should be raised.
- Identify which current IDs and `data-*` hooks must remain untouched.
- Preserve source-first architecture and viewport-invariant authored layout.

Do not implement the redesign in this task.

Finish with:

- documents created;
- commands and results;
- screenshot paths;
- top five design decisions;
- unresolved questions that truly block implementation, if any.
