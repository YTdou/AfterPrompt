# Command and agent workflows

The local CLI uses the same document and command model as the visual editor. It does not overwrite input unless `--in-place` is explicit.

```bash
npm run cli -- list examples/ai-slide.html
npm run cli -- get examples/ai-slide.html title-001
npm run cli -- summary examples/ai-slide.html --output /tmp/slide-structure.json
npm run cli -- apply examples/ai-slide.html --commands examples/codex-commands.json --output /tmp/edited.html
```

Use `prepare` to add stable IDs to a new input. `validate` and export commands check the resulting document. Fragment commands include `fragment-create`, `fragment-pack`, `fragment-inspect`, `fragment-validate`, `fragment-insert`, and `fragments`; run `npm run cli -- --help` for the current arguments.

Structured commands cover text/style updates, movement, sizing, rotation, visibility, locking, tree ordering, add/delete operations, component properties and slots, and presentation-build organization. Treat the CLI output and validation result as evidence; do not assume browser layout geometry where the CLI has no layout engine.
