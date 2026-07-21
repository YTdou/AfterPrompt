# Visual Fragments

A `.vfrag` is a versioned ZIP package for reusing selected visual nodes while keeping standard HTML/SVG structure central. The public manifest contract is `schemas/visual-fragment-manifest.schema.json`.

- Format 1.0 stores HTML/SVG structure; 1.1 also covers single-layer PNG/JPEG raster fragments.
- Source-preserving mode keeps selected structure and matched declarations; self-contained mode captures more computed style.
- Imports validate the manifest, archive paths, file counts, sizes, IDs, CSS, fonts, and resources before insertion.
- ID and URL references are rewritten to prevent silent collisions on repeated insertion.
- A linked instance updates only after an explicit user synchronization action; there is no background registry or cloud resolver.
- A connected local directory is the durable user-owned library. IndexedDB is only a temporary clipboard and may be cleared by the browser.

See `src/core/fragments/` and `tests/fragments.test.ts` for executable semantics.
