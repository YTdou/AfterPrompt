# Autonomous Product Falsification — Campaign 01

Date: 2026-07-19  
Candidate lineage: `d192f9f0eae79fc3d97b7af6e885258e097d8a0f`  
Comparison baseline: `main@8e2226c582e82830269fff531f3a1cace9a2fd18`

This report records one bounded campaign under `problem/self_check.md`. It does not claim that the product has no other defects.

## Exploration Map

The simplified product model was:

```text
canonical DOM + project assets
  -> page / Build / selection context
  -> UI, keyboard, pointer, CLI, and fragment commands
  -> history
  -> source / project / presentation / fragment exports
  -> reimport and persistence
```

The campaign exercised these state dimensions:

- single-page HTML and page 2 of a three-page deck;
- empty, pending, and ready application-clipboard states;
- button focus, text-input focus, modal open, and modal closed;
- Ctrl/Shift multi-selection in both selection orders;
- single selection, group selection, group drag, Undo, and Redo;
- temporary fragment storage, connected directory, external deletion, reopen, disconnect, and reconnect;
- paste, page context, history, export, and reimport.

Weak or incompletely explored areas remain:

- directory permission loss, partial writes, and same-identity migration collisions;
- broader UI/CLI differential testing for malformed Raster inputs;
- long-lived sessions and high-volume history/resource growth;
- generalized code coverage and campaign-wide mutation coverage;
- modal-specific shortcut policy, which is not currently specified.

## Campaign Configuration

- Browser: headless local Chromium/Chrome wrapper, normally at `1600 x 1000`.
- Runtime: Node `20.20.0`; the repository declares Node `>=22`, so runtime-specific failures were classified separately.
- Initial candidate was a clean `d192f9f` worktree. The initial known-path baseline passed 74 unit tests, typecheck, build, and the full browser smoke when local binding was allowed.
- Explorer budget: 27 browser-sequence attempts across four high-risk regions, nine feature pairs, and four feature triples.
- Independent verification snapshot: `/tmp/justtry-independent-verifier.M528dz/repo`, tracked-diff SHA-256 `a8ae223e4ad39239b367e388c0bbea07e26d3aff8572b40e6a9dad1bc4a0c25d`.
- The live shared worktree changed concurrently during the campaign. Unrelated inspector, style-control, font-catalog, notice, and layout-parity work was preserved and excluded from the repair claim.

## Novel Findings

### A. Confirmed and repaired: multi-selection crashes Moveable

Ctrl/Shift multi-selection updated the logical selection but raised an uncaught `MoveableGroup.updateRect` null-`style` exception. No usable group drag area was created, and repeated single/group transitions accumulated stale control boxes.

- Classification: confirmed product defect.
- Severity: high / P1.
- Novelty: not covered by the existing browser smoke; independently reproduced on both `main@8e2226c` and candidate `d192f9f`.
- Explorer reproduction: 5/5 fresh-context variants.
- Minimized/variant reproduction: 16/16.
- Authoritative contract: `README.md` promises Ctrl/Shift multi-selection and Moveable transforms.

### B. Rejected: paste while a modal button has focus

With the temporary clipboard manager open and its Close button focused, Ctrl+V pasted behind the modal. The behavior reproduced 3/3, but the current documented shortcut boundary enables application copy/paste in every non-text-editing state and only exempts inputs/code editors.

- Classification: incorrect modal-isolation test model under the current contract.
- Repair eligibility: no. A dialog-specific keyboard policy must be specified first.
- Learning: observable surprise is not sufficient evidence when the explicit shortcut contract points in the other direction.

### C. Confirmed, not repaired in this branch: immediate Ctrl+C then Ctrl+V loses the paste

The copy and paste handlers launch independent asynchronous operations. Paste can read the temporary library before copy publishes the new record.

- Classification: confirmed product defect.
- Severity: medium / P2.
- Candidate-only: the application Ctrl/Cmd+C/V path was introduced by `d192f9f`.
- Timing boundary: 0 ms failed 6/6; 10 ms failed 1/1; 50/100/250/500 ms and wait-for-toast controls passed.
- Risk: with a non-empty clipboard, rapid paste can select an older record instead of merely doing nothing.
- Disposition: recorded for a fresh branch/campaign because Campaign 01 permits one repaired root cause.

## Passed Adjacent Sequences

- Directory external deletion followed by close/reopen rebuilt the library from one card to zero; disconnect retained the temporary copy; reconnecting the empty directory still showed zero.
- Cross-document application clipboard -> page-2 paste -> Undo -> Redo -> export -> reimport preserved the image and page identity.
- After the A repair, independent checks passed single child drag, parent recovery, inline text editing, and Space-pan without changing the selected element's semantic transform.

## Minimal Counterexamples

### Finding A

Minimal authored input:

```html
<div>
```

Minimal action sequence:

1. Select layer `document-root`.
2. Ctrl-click layer `div-001`.

Before repair, the transition `single -> group` raised the uncaught exception, produced no usable group controls, and leaked more controls on every retry. The source remained unchanged, so this was a behavioral/runtime-state defect rather than canonical document corruption.

Durable replay now lives inline in `scripts/browser-smoke.mjs`. Original traces, screenshots, timing controls, and minimized JSON were collected under `/tmp/c01-*` and `/tmp/justtry-min-d192-Tcvfle/evidence/` during this campaign.

### Finding C

1. Start with a clean temporary application clipboard.
2. Select one element.
3. Press Ctrl+C and immediately press Ctrl+V without waiting for a toast.

The copy toast arrives later, but the missed paste is never replayed. A next campaign should add a stale-record variant before choosing the serialization mechanism.

## Oracle Assessment

Finding A was accepted because:

- the browser itself emitted an uncaught exception;
- the failure reproduced across Ctrl/Shift, reverse order, text/image, siblings/ancestors, viewports, and timing;
- `main` and candidate both reproduced it with the same dependency version;
- the documented multi-select transform surface was unavailable;
- normal reselection did not recover runtime controls.

Finding C was accepted because:

- documentation presents copy then paste without a readiness delay;
- implementation launches both asynchronous handlers without ordering;
- copy publishes only after awaited storage, while paste immediately reads the latest stored record;
- delay controls expose a stable timing boundary and the existing smoke explicitly waits for the copy toast.

Finding B was rejected because the proposed modal-isolation oracle contradicted the current documented non-text-editing shortcut scope.

## Repair

Only Finding A was repaired.

The pre-fix browser regression was added and shown to fail for the expected exception. The final implementation constructs a replacement Moveable instance with its final single or group target when crossing manager modes. This lets Moveable choose the correct manager on its first render instead of switching `null/single -> array` through `setState`. Zoom, keep-ratio state, and event handlers are preserved.

The regression checks:

- the selection reaches `2 elements selected`;
- no browser runtime error is emitted;
- group drag area has non-zero bounds;
- single and group control-box counts remain stable across repeated transitions.

Failed narrower attempts were retained as negative evidence: enabling group drag area alone removed the crash but leaked controls `4 -> 6 -> 8`; removing immediate `updateRect`, asynchronous clearing, animation-frame gaps, and reconstruction from `target:null` also failed or regressed child dragging.

## Independent Verification

The verifier used a frozen snapshot rather than the drifting live tree.

- Selection matrix: 7 scenarios x 3 cycles = 21 group entries and 21 removals.
- Coverage: Ctrl/Shift, order symmetry, siblings/ancestors, text/image, three viewports, and 0/75/250 ms timing.
- Stable result: single control boxes `1,1,1,1`; group control boxes `3,3,3`; one usable group drag area each time; zero runtime errors.
- Actual group drag: both canonical elements moved from `(0,0)` to `(65.1851852,41.4814815)`; Undo restored both; Redo restored both moved transforms.
- Unit suite: 10 files / 79 tests passed.
- Typecheck and Vite production build passed; only the existing chunk-size warning remained.
- Targeted semantic mutation: restoring the old `null -> setState(array)` transition caused the new regression to fail on the first original group path, so the mutation was killed (1/1 targeted mutation, 100%).

The full browser smoke on the frozen concurrent snapshot failed before reaching Finding A because `#notice-bar` remained visible beyond its 7-second acceptance window. This is unrelated to the repaired root cause, but it means Campaign 01 does not claim that the current live browser smoke is globally green.

## Learning Update

- Generalized generator rule: every selection test should include single -> group -> single repetition, modifier and order symmetry, and at least one real group drag.
- Generalized state relation: switching Moveable manager modes must not leave controls owned by the previous mode.
- Feature-interaction edge: layer-tree additive selection x Moveable lifecycle x group drag x history.
- Semantic mutation: replace construction with an initial array target by `target:null` followed by `setState(array)`; the browser regression must kill it.
- Deduplication signature: `MoveableGroup.updateRect` null-`style` exception plus missing group drag area or monotonically growing `.moveable-control-box` count.
- Regression location: the existing real-browser acceptance path, not a DOM-only unit test.

## Quality Metrics

| Metric | Campaign 01 result |
|---|---:|
| Browser sequence attempts | 27 exploration attempts plus independent replay |
| Feature-pair coverage | 9 named pairs |
| Feature-triple coverage | 4 named triples |
| Independent selection transitions | 21 group entries + 21 removals |
| Confirmed previously unknown defects | 2 |
| Repaired root causes | 1 |
| Minimized confirmed counterexamples | 2 |
| Candidate anomalies rejected by critic | 1 / 3 (33.3%) |
| Duplicate-defect rate | 0% |
| Median action length before/after shrinking | 2 -> 2; Finding A input shrank to 5 characters |
| Targeted mutation score | 1 / 1 killed (100%) |
| General code coverage | Not instrumented |
| Campaign-wide mutation score | Not measured |

The most important remaining action is a separate campaign for Finding C. The unrelated notice auto-dismiss browser-smoke failure must also be triaged against the concurrently changing live tree before any global release-readiness claim.
