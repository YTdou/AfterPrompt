# Autonomous Product Falsification — Campaign 02

Date: 2026-07-19  
Baseline: `5fa90567c3faa2dbbcf1046a006309bd234baf4f`  
Final code-and-browser-test diff SHA-256: `0034e871aa38f3911c3fced00d8b4f0670738d5e1ff07f1b0459995ba5d5c4d9`

Campaign 02 repairs Finding C from Campaign 01: application Ctrl/Cmd+C followed immediately by Ctrl/Cmd+V could read an empty or stale IndexedDB clipboard record. It also independently adjudicates the historical notice-bar smoke failure. It does not claim that no other defects exist.

## Confirmed Defect

The old keyboard path launched copy and paste as independent asynchronous operations:

```text
copy -> extract -> await IndexedDB save -> publish new record
paste -------------------------------> latestRecord
```

Observed before repair:

- empty first rapid C/V: 0 ms failed 6/6 and 10 ms failed 1/1;
- 50/100/250/500 ms controls passed;
- with an existing record, paste could observe the previous record instead of the current selection;
- the existing browser smoke waited for the copy toast and therefore did not cover the race.

The documented workflow does not require a delay or toast acknowledgement, so program-order preservation is the authoritative oracle.

## Minimal Counterexamples

Empty state:

1. Open a fresh browser context.
2. Select one canvas element.
3. Press Ctrl/Cmd+C and immediately Ctrl/Cmd+V.
4. Expected: the selected element is inserted as a clipboard fragment.

Stale state:

1. Put element A into the application clipboard.
2. Select different element B.
3. Press Ctrl/Cmd+C and immediately Ctrl/Cmd+V.
4. Expected: the inserted content is B, never A.

## Repair

`FragmentWorkspace` now owns one Promise command queue for application copy and paste operations.

- Copy and paste execute in invocation order.
- Copy captures its `FragmentWorkspaceContext` when the keyboard command is invoked, before waiting behind earlier commands.
- Copy completes package extraction and IndexedDB save before the following paste calls `latestRecord()`.
- Paste remains inside the queue, so rapid repeated V operations update the 16 px paste sequence deterministically.
- The queue stores a rejection-recovered tail so an unexpected failed command cannot permanently block later commands.
- No fixed delay, dependency change, fragment-format change, or modal-policy change was introduced.

The browser regression covers both empty and stale states with real Control+C/Control+V key presses and compares inserted content with the current source element. Probe insertions are removed through Undo. The later existing library-preview test waits for the exact title copy and selects its matching card so the new stale-state setup cannot pollute unrelated preview assertions.

## Independent Verification

Frozen patched snapshot: `/tmp/justtry-clipboard-verify.UVbAgT`.

Real-browser results:

| Sequence | Result |
|---|---:|
| Fresh empty rapid C/V | 5/5 |
| Stale-record rapid C/V | 5/5 |
| `C(title), V, C(takeaway), V` stress | 5/5 |
| Repeated V offset | 1/1 |
| Invocation-time selection context | 1/1 |
| Invocation-time page context | 1/1 |
| Native textarea isolation | 1/1 |
| CodeMirror isolation | 1/1 |
| Page paste | 1/1 |
| Undo/Redo | 2/2 |
| Export/reimport | 1/1 |

Semantic mutation:

- mutation snapshot: `/tmp/justtry-clipboard-mutation.4jLxF5`;
- both public commands bypassed the queue and directly invoked their asynchronous implementations;
- the same verifier was killed 1/1 on the first fresh-empty C/V sequence because no pasted selection appeared within 5 seconds;
- targeted mutation score: 1/1 killed, 100%.

Repository acceptance after the final test-isolation adjustment:

- `npm run check`: 10 test files / 82 tests passed; TypeScript and Vite production build passed;
- `STUDIO_BASE_URL=http://127.0.0.1:43211 npm run test:browser`: passed with `rapidClipboardCommandOrdering: true` and all existing smoke signals true;
- `git diff --check`: passed;
- build retained the existing large-chunk warning.

## Notice-Bar Oracle Review

The earlier report contained one frozen concurrent-snapshot failure where `#notice-bar` was still visible after 7 seconds. Campaign 02 rebuilt clean `HEAD 5fa90567` and tested it independently.

- reproduction: 0/3 fresh browser contexts;
- notice appeared at 197.5–248.8 ms;
- it hid and cleared at 4192.9–4243.1 ms;
- measured visible duration: 3994–3995 ms, matching the 4-second product contract;
- hidden state: `hidden=true`, empty text, `display:none`, height 0;
- no later notice reset, page error, request failure, or delayed font event;
- the original unmodified full browser smoke passed 1/1.

Classification: stale/concurrent build snapshot or one-time environment nondeterminism. No product or test repair was eligible. The timeout and `showNotice` behavior were not changed.

## Learning Update

- Generalized generator rule: async shortcut pairs must be tested with empty and stale persistent state, not only after a success toast.
- Generalized metamorphic relation: `C(B) -> V` must produce B regardless of prior clipboard value A or storage latency.
- Feature-interaction edge: keyboard command order x IndexedDB latency x selection/page context x history.
- Semantic mutation: bypass the command queue at both public C/V methods; the empty-state regression must kill it.
- Deduplication signature: copy toast eventually succeeds, but immediate paste produces no selection or inserts content different from the invocation-time selection.
- Test-isolation rule: exploratory clipboard records must not be consumed through an unqualified `.first()` selector by later library assertions.

## Remaining Risks

- The queue is in-memory per `FragmentWorkspace`; it does not coordinate simultaneous browser tabs, which is outside the current application shortcut contract.
- IndexedDB quota/transaction failures remain surfaced as errors; recovery after explicit storage failure was not fault-injected in this campaign.
- Node `20.20.0` was used for this campaign while the package declares Node `>=22`; all current checks passed, but release validation should continue using the declared runtime.
