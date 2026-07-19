# Bounded review/fix loop for each Codex UI phase

Use this prompt after an implementation phase, in the same branch but preferably a fresh Codex thread.

Review only the current phase diff and the approved UI documents. Do not edit during the first pass.

## Pass A — observe and falsify

1. Read `AGENTS.md`, the relevant phase prompt, UI design/acceptance docs, and the current diff.
2. Run the phase gate.
3. Inspect the required screenshots.
4. Use Impeccable.
5. Use Web Design Guidelines.
6. Try to falsify the phase with:
   - compact and wide viewport;
   - no selection / single / multi selection;
   - panel expanded / collapsed;
   - keyboard-only navigation;
   - long translated labels;
   - error and empty states;
   - HTML / deck / SVG where relevant.
7. Report exact P0/P1/P2 findings with selector, file, evidence, and violated acceptance criterion.

## Pass B — repair

Fix only P0 and P1 findings. Keep each fix minimal. Do not rewrite tests before reproducing the mismatch. Do not weaken an oracle.

Run the phase gate and recapture affected screenshots.

## Pass C — re-audit

Repeat the two skill audits once. If no P0/P1 remains, stop.

Maximum three repair cycles total. If the same failure appears twice:

- revert the smallest failed patch;
- reduce the implementation scope;
- record the blocker and evidence;
- stop rather than cycling or weakening assertions.
