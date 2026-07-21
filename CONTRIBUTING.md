# Contributing to AfterPrompt

Thank you for contributing. Keep changes focused, preserve standard HTML/SVG as the canonical artifact, and include evidence appropriate to the area changed.

## Setup and checks

Use Node.js 22 or newer and npm:

```bash
npm install
npm run check
```

For UI behavior, also run `npm run test:browser` with Chrome/Chromium and attach a before/after capture when visual output changes.

## Contribution map

| Contribution | Primary location | Required evidence |
|---|---|---|
| Canvas or transforms | `src/canvas/`, `src/ui/` | focused tests + real before/after capture |
| Document semantics | `src/core/document-model.ts`, `src/core/commands.ts` | unit/round-trip tests |
| Slides and builds | `src/core/presentation*.ts` | presentation tests + preview/export check |
| CLI or agent commands | `src/cli/`, shared command layer | command example + tests |
| Visual Fragments | `src/core/fragments/`, `schemas/` | schema/compatibility tests |
| Docs or translation | `README*`, `docs/` | local-link and canonical-language review |
| Examples | `examples/` | opens, edits, and exports successfully |

## Invariants

Do not introduce byte-identical round-trip claims, execute imported scripts in the editing canvas, or mix license changes into ordinary feature work. Keep security and compatibility limits explicit.

## Pull requests

Explain the user-visible result, scope, compatibility impact, tests run, and known limits. Keep generated build output and private fixtures out of the diff. Small, reviewable commits are preferred.

## Contribution license and provenance

Unless explicitly stated otherwise in writing, a contribution intentionally submitted for inclusion is provided under the repository's existing license terms. Every commit must include a Developer Certificate of Origin sign-off via `git commit -s`.

Submit only material you have the right to contribute. Identify third-party source and version, retain required notices, and update `THIRD_PARTY_NOTICES.md` when appropriate. AI-assisted contributions require the same provenance, security, and license review as manually authored work. Brand rights remain governed by `TRADEMARKS.md`.
