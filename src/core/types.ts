export type DocumentKind = "html" | "svg";

export interface CanvasSize {
  width: number;
  height: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementTreeNode {
  id: string;
  tag: string;
  name: string;
  text?: string;
  locked: boolean;
  visible: boolean;
  children: ElementTreeNode[];
}

export interface DocumentPage {
  id: string;
  label: string;
  index: number;
}

export interface ElementSummary {
  id: string;
  type: string;
  tag: string;
  name: string;
  text?: string;
  bounds: Bounds;
  parentId: string | null;
  locked: boolean;
  visible: boolean;
  className?: string;
  attributes: Record<string, string>;
}

export interface StructureSummary {
  documentType: DocumentKind | "html-slide";
  canvas: CanvasSize;
  elements: ElementSummary[];
  fragments: FragmentInstanceSummary[];
}

export interface FragmentInstanceSummary {
  elementId: string;
  definitionId: string;
  instanceId: string;
  version: string;
  linked: boolean;
  properties: string[];
  slots: string[];
}

export interface TransformValues {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface ElementChanges {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  text?: string;
  fontFamily?: string;
  fontSize?: number | string;
  fontWeight?: number | string;
  lineHeight?: number | string;
  letterSpacing?: number | string;
  textAlign?: string;
  color?: string;
  backgroundColor?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number | string;
  opacity?: number;
  borderRadius?: number | string;
  boxShadow?: string;
  filter?: string;
  className?: string;
  style?: Record<string, string | number | null>;
  visible?: boolean;
  locked?: boolean;
  name?: string;
  src?: string;
  objectFit?: string;
}

export interface NewElementSpec extends ElementChanges {
  id?: string;
  type: "text" | "image" | "rect" | "circle" | "group" | "container";
  tag?: string;
}

export type ComponentPropertyValue = string | number | boolean;

export type EditorCommand =
  | { action: "updateElement"; elementId: string; changes: ElementChanges }
  | { action: "replaceText"; elementId: string; text: string }
  | { action: "moveElement"; elementId: string; x: number; y: number }
  | { action: "moveElementBy"; elementId: string; dx: number; dy: number }
  | { action: "resizeElement"; elementId: string; width: number; height: number }
  | { action: "rotateElement"; elementId: string; angle: number }
  | { action: "updateStyle"; elementId: string; style: Record<string, string | number | null> }
  | { action: "deleteElement"; elementId: string }
  | { action: "addElement"; parentId: string; element: NewElementSpec }
  | { action: "updateComponentProperties"; elementId: string; properties: Record<string, ComponentPropertyValue> }
  | { action: "insertIntoComponentSlot"; elementId: string; slot: string; element: NewElementSpec }
  | { action: "unlinkComponentInstance"; elementId: string }
  | { action: "setVisibility"; elementId: string; visible: boolean }
  | { action: "setLocked"; elementId: string; locked: boolean }
  | { action: "reorderElement"; elementId: string; direction: "up" | "down" | "front" | "back" };

export interface CommandResult {
  action: EditorCommand["action"];
  elementId: string;
  createdId?: string;
}

export interface DocumentSnapshot {
  source: string;
  kind: DocumentKind;
  canvas: CanvasSize;
  sourceName: string;
  selectedIds: string[];
  activePageId?: string;
  assets?: ProjectAsset[];
}

export interface ProjectAsset {
  path: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface SavedProjectAsset {
  path: string;
  mimeType: string;
  base64: string;
}

export interface OperationLogEntry {
  at: string;
  label: string;
  elementIds: string[];
  source: "ui" | "code" | "history" | "cli";
}

export interface SavedProject {
  format: "last-mile-studio";
  version: 1;
  source: string;
  sourceName: string;
  sourcePath: string;
  documentType: DocumentKind;
  canvas: CanvasSize;
  assets: SavedProjectAsset[];
  operations: OperationLogEntry[];
  metadata: {
    savedAt: string;
    generator: string;
  };
}
