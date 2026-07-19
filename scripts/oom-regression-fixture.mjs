const PAGE_COUNT = 18;
const LARGE_FONT_PAYLOAD = "A".repeat(700_000);
const LARGE_FONT_FACE = `@font-face{font-family:"OOM Fixture";src:url(data:font/woff2;base64,${LARGE_FONT_PAYLOAD}) format("woff2");font-weight:400;font-style:normal}`;

export const OOM_FIXTURE_IDS = Object.freeze({
  fragmentRoot: "oom-fragment-root",
  copyRoot: "oom-copy-root",
  editableText: "oom-edit-text",
});

function pageBody(index) {
  if (index === 14) {
    return `
      <article class="fixture-card" data-editor-id="${OOM_FIXTURE_IDS.fragmentRoot}">
        <i data-editor-id="oom-dot-low"></i>
        <i data-editor-id="oom-dot-medium"></i>
        <i data-editor-id="oom-dot-high"></i>
        <span data-editor-id="oom-shot-label">L · M · H</span>
      </article>
      <b data-editor-id="${OOM_FIXTURE_IDS.editableText}">A800 × Llama</b>`;
  }
  if (index === 17) {
    return `<div data-editor-id="${OOM_FIXTURE_IDS.copyRoot}"><p data-editor-id="oom-copy-text">Same α · same predicted latency map</p></div>`;
  }
  return `<p data-editor-id="oom-page-copy-${String(index + 1).padStart(2, "0")}">Deterministic OOM page ${index + 1}</p>`;
}

export function buildOomRegressionFixture() {
  const pages = Array.from({ length: PAGE_COUNT }, (_, index) => `
    <section data-editor-id="oom-page-${String(index + 1).padStart(2, "0")}" data-label="OOM Page ${index + 1}">
      <style data-vfrag-style="oom-page-${index + 1}">${LARGE_FONT_FACE}</style>
      ${pageBody(index)}
    </section>`).join("");

  const source = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    ${LARGE_FONT_FACE}
    html,body{margin:0;width:100%;height:100%}
    deck-stage{display:block;width:1920px;height:1080px;position:relative;background:#fff}
    deck-stage>section{display:none;position:absolute;inset:0;padding:80px;box-sizing:border-box}
    deck-stage>section[data-editor-preview-page-root="active"]{display:block}
    .fixture-card{display:flex;align-items:center;gap:12px}
    .fixture-card i{display:block;width:24px;height:24px;background:#f2a900;border-radius:6px}
  </style>
</head>
<body data-editor-id="oom-document" data-editor-canvas-width="1920" data-editor-canvas-height="1080">
  <deck-stage data-editor-id="oom-deck" width="1920" height="1080">${pages}
  </deck-stage>
</body>
</html>`;

  return {
    source,
    sourceName: "oom-regression-fixture.html",
    pageCount: PAGE_COUNT,
    ids: OOM_FIXTURE_IDS,
  };
}
