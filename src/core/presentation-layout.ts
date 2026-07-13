export const PRESENTATION_PAGE_BOX = `
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  min-width: 0 !important;
  min-height: 0 !important;
  box-sizing: border-box !important;
`;

export const editorPresentationLayoutCss = `
  [data-editor-static-deck] {
    display: block !important;
    position: relative !important;
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    overflow: hidden !important;
    visibility: visible !important;
    opacity: 1 !important;
  }
  [data-editor-preview-page-root] {
    ${PRESENTATION_PAGE_BOX}
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
  [data-editor-preview-page-root="active"] {
    ${PRESENTATION_PAGE_BOX}
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
    pointer-events: auto !important;
  }
`;

export const runtimePresentationLayoutCss = `
  :root, html, body { width: 100% !important; height: 100% !important; min-width: 0 !important; min-height: 0 !important; margin: 0 !important; overflow: hidden !important; }
  [data-lms-deck] { display: block !important; position: relative !important; width: 100% !important; height: 100% !important; min-width: 0 !important; min-height: 0 !important; visibility: visible !important; opacity: 1 !important; overflow: hidden !important; }
  [data-lms-slide] { ${PRESENTATION_PAGE_BOX} }
  [data-lms-slide="inactive"] { display: none !important; visibility: hidden !important; pointer-events: none !important; }
  [data-lms-slide="active"] { display: block !important; visibility: visible !important; opacity: 1 !important; pointer-events: auto !important; }
  [data-lms-build-visible="false"] { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }
`;
