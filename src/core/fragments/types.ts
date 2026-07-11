import type { Bounds, ProjectAsset } from "../types";

export const VISUAL_FRAGMENT_FORMAT = "last-mile-studio.visual-fragment" as const;
export const VISUAL_FRAGMENT_FORMAT_VERSION = "1.0" as const;

export type VisualFragmentType = "element" | "group" | "component" | "template";
export type VisualFragmentContentType = "html" | "svg";
export type VisualFragmentSaveMode = "source-preserving" | "self-contained";
export type VisualFragmentPropertyType =
  | "text"
  | "number"
  | "color"
  | "image"
  | "icon"
  | "boolean"
  | "enum"
  | "size"
  | "url";

export type VisualFragmentPropertyBinding =
  | { kind: "text" }
  | { kind: "attribute"; name: string }
  | { kind: "style"; name: string }
  | { kind: "css-variable"; name: `--${string}` };

export interface VisualFragmentProperty {
  name: string;
  label: string;
  type: VisualFragmentPropertyType;
  target: string;
  binding: VisualFragmentPropertyBinding;
  defaultValue?: string | number | boolean;
  required?: boolean;
  options?: string[];
}

export interface VisualFragmentSlot {
  name: string;
  label: string;
  target: string;
  allowedElementTypes: string[];
  required: boolean;
  multiple: boolean;
  defaultContent?: string;
  size?: {
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
  };
}

export interface VisualFragmentAssetDependency {
  path: string;
  mimeType: string;
  source: string;
  required: boolean;
  external?: boolean;
}

export interface VisualFragmentFontDependency {
  family: string;
  source?: string;
  bundled: boolean;
}

export interface VisualFragmentManifest {
  format: typeof VISUAL_FRAGMENT_FORMAT;
  formatVersion: typeof VISUAL_FRAGMENT_FORMAT_VERSION;
  fragmentId: string;
  name: string;
  description: string;
  fragmentType: VisualFragmentType;
  contentType: VisualFragmentContentType;
  saveMode: VisualFragmentSaveMode;
  entry: "content.html" | "content.svg";
  styles: "styles.css";
  tokens: "tokens.json";
  preview: "preview.svg";
  canvas: {
    width: number;
    height: number;
  };
  coordinateSystem: {
    unit: "px";
    origin: { x: number; y: number };
    originalBounds: Bounds;
  };
  insertion: {
    anchor: "top-left" | "center";
  };
  properties: VisualFragmentProperty[];
  slots: VisualFragmentSlot[];
  assets: VisualFragmentAssetDependency[];
  fonts: VisualFragmentFontDependency[];
  permissions: {
    scripts: false;
    network: "none" | "declared";
    origins: string[];
  };
  provenance: {
    sourceProject: string;
    sourceDocument: string;
    createdAt: string;
    generator: string;
  };
  version: string;
  tags: string[];
  category: string;
}

export interface VisualFragmentPackage {
  manifest: VisualFragmentManifest;
  content: string;
  styles: string;
  tokens: Record<string, string>;
  assets: ProjectAsset[];
  previewSvg: string;
  warnings: string[];
}

export interface VisualFragmentValidationIssue {
  path: string;
  message: string;
}

export interface VisualFragmentValidationResult {
  valid: boolean;
  issues: VisualFragmentValidationIssue[];
}

export interface VisualFragmentCompatibilityReport {
  compatible: boolean;
  sourceType: VisualFragmentContentType;
  targetType: VisualFragmentContentType;
  idRemaps: Record<string, string>;
  editorIdRemaps: Record<string, string>;
  cssConflicts: string[];
  missingFonts: string[];
  missingAssets: string[];
  externalResources: string[];
  warnings: string[];
  errors: string[];
}

export type VisualFragmentPlacement =
  | { mode: "original" }
  | { mode: "center" }
  | { mode: "point"; x: number; y: number };

export interface VisualFragmentInsertOptions {
  parentId: string;
  placement: VisualFragmentPlacement;
  linked: boolean;
  targetSourcePath?: string;
}

export interface VisualFragmentInsertPlan {
  fragment: VisualFragmentPackage;
  report: VisualFragmentCompatibilityReport;
  parentId: string;
  placement: VisualFragmentPlacement;
  linked: boolean;
  content: string;
  styles: string;
  assets: ProjectAsset[];
  assetPathRemaps: Record<string, string>;
  rootEditorIds: string[];
  instanceId?: string;
}

export interface VisualFragmentInsertResult {
  rootEditorIds: string[];
  instanceId?: string;
  report: VisualFragmentCompatibilityReport;
}

export interface VisualFragmentLibraryRecord {
  key: string;
  fragmentId: string;
  version: string;
  manifest: VisualFragmentManifest;
  packageBytes: Uint8Array;
  favorite: boolean;
  useCount: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface VisualFragmentLibraryQuery {
  search?: string;
  tags?: string[];
  category?: string;
  favoritesOnly?: boolean;
  recentFirst?: boolean;
}

export interface VisualFragmentExtractOptions {
  fragmentId?: string;
  name: string;
  description?: string;
  fragmentType: VisualFragmentType;
  saveMode: VisualFragmentSaveMode;
  category?: string;
  tags?: string[];
  version?: string;
  sourceProject?: string;
  properties?: VisualFragmentProperty[];
  slots?: VisualFragmentSlot[];
}

export interface VisualFragmentSelectionItem {
  element: Element;
  bounds: Bounds;
  renderedElement?: Element | null;
}
