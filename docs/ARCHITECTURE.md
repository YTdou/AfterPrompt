# Architecture

AfterPrompt keeps a standard HTML or SVG document as the canonical artifact. `DocumentModel` parses and serializes it, assigns stable editor IDs, applies shared commands, and preserves the last valid document when a source draft fails to parse.

```text
HTML / SVG / project JSON
        ↓
document model + stable IDs ← CLI / JSON commands
        ↓
sanitized render clone → real DOM/SVG canvas → visual commands
        ↓
source view / preview / standard export / .vfrag
```

- `src/core/document-model.ts`: document lifecycle and command boundary.
- `src/core/sanitizer.ts`: editing-surface filtering.
- `src/canvas/renderer.ts`: Shadow DOM HTML and native SVG canvas mapping.
- `src/canvas/transform-controller.ts`: drag, resize, rotate, and snapping adaptation.
- `src/ui/editor-app.ts`: workspace orchestration and public UI workflows.
- `src/core/presentation*.ts`: pages, builds, layout, preview, and HTML export.
- `src/core/fragments/`: versioned fragment packages, compatibility, components, and instances.
- `src/cli/index.ts`: local structured-command workflows.

Visual operations and CLI operations converge on shared document commands. Preview is a restricted derivative view; exported HTML is the canonical document serialization and can retain source runtime behavior.
