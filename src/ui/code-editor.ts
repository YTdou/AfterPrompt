import { html } from "@codemirror/lang-html";
import { openSearchPanel, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";

const studioTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "#10131a",
    color: "#dfe5f2",
    fontSize: "12px",
  },
  ".cm-content": {
    fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
    caretColor: "#8bb4ff",
    padding: "12px 0",
  },
  ".cm-gutters": {
    backgroundColor: "#0c0f15",
    color: "#596273",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "rgba(70, 101, 160, .12)" },
  ".cm-activeLineGutter": { backgroundColor: "rgba(70, 101, 160, .18)" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "#294a7a !important" },
  ".cm-scroller": { overflow: "auto" },
}, { dark: true });

export class SourceCodeEditor {
  readonly view: EditorView;
  private settingValue = false;

  constructor(host: HTMLElement, onChange: (dirty: boolean) => void) {
    const state = EditorState.create({
      doc: "",
      extensions: [
        basicSetup,
        html({ matchClosingTags: true, autoCloseTags: true }),
        keymap.of(searchKeymap),
        studioTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !this.settingValue) onChange(true);
        }),
      ],
    });
    this.view = new EditorView({ state, parent: host });
  }

  get value(): string {
    return this.view.state.doc.toString();
  }

  setValue(value: string): void {
    if (value === this.value) return;
    this.settingValue = true;
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value } });
    this.settingValue = false;
  }

  focusElement(elementId: string): boolean {
    const source = this.value;
    const doubleQuoted = `data-editor-id="${elementId}"`;
    const singleQuoted = `data-editor-id='${elementId}'`;
    let index = source.indexOf(doubleQuoted);
    let length = doubleQuoted.length;
    if (index < 0) {
      index = source.indexOf(singleQuoted);
      length = singleQuoted.length;
    }
    if (index < 0) return false;
    this.view.dispatch({
      selection: { anchor: index, head: index + length },
      effects: EditorView.scrollIntoView(index, { y: "center" }),
    });
    return true;
  }

  openSearch(): void {
    this.view.focus();
    openSearchPanel(this.view);
  }

  destroy(): void {
    this.view.destroy();
  }
}
