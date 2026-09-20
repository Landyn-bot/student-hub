/**
 * Normalised intermediate representation (IR) of a course document.
 *
 * Everything downstream of the parser (the model, validation, the review screen) depends on
 * this shape only. It is the contract between deterministic parsing and the AI: the model sees
 * `IrChunk.text` and nothing from the original container.
 */

export type IrBlockType = "heading" | "paragraph" | "list_item" | "table_row" | "code";

export interface IrBlock {
  type: IrBlockType;
  /** Heading level 1-6, list depth for list items. */
  level?: number;
  /** Set on table rows so a chunk split mid-table can repeat the header row. */
  tableId?: number;
  isHeader?: boolean;
  /** Prefix used when rendering ordered list items ("1. "). */
  marker?: string;
  text: string;
}

export interface IrDocument {
  index: number;
  id: string;
  path: string;
  title: string;
  blocks: IrBlock[];
  wordCount: number;
}

export interface IrChunk {
  /** `${documentIndex}-${part}` */
  id: string;
  documentIndex: number;
  documentTitle: string;
  documentPath: string;
  /** Heading breadcrumb at the start of the chunk, e.g. "Module 3 › Week 4". */
  section: string;
  /** Where each block begins inside `text`, so a quote can be traced to its own section. */
  sections: { offset: number; section: string }[];
  part: number;
  totalParts: number;
  text: string;
}

export interface IrMetadata {
  title: string | null;
  authors: string[];
  language: string | null;
  publisher: string | null;
  identifier: string | null;
  published: string | null;
  description: string | null;
}

export interface IrTocEntry {
  title: string;
  path: string | null;
  depth: number;
}

export interface NormalizedCourse {
  source: {
    kind: "epub" | "text";
    filename: string;
    sha256: string;
    sizeBytes: number;
  };
  metadata: IrMetadata;
  toc: IrTocEntry[];
  chunks: IrChunk[];
  warnings: string[];
  stats: { documents: number; chunks: number; characters: number; words: number };
}
