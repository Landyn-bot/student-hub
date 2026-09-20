/**
 * EPUB bytes -> NormalizedCourse. Steps 3-6 of the ingestion pipeline:
 *   validate + safely extract  ->  read manifest and spine  ->  parse pages in order
 *   ->  normalise to blocks  ->  chunk.
 * No model is involved; every decision here is deterministic and testable.
 */
import { ImportError } from "./errors.ts";
import type { IrDocument, NormalizedCourse } from "./ir.ts";
import {
  blocksFromText,
  buildChunks,
  countWords,
  extractBlocks,
  renderBlock,
} from "./normalize.ts";
import { readPackage } from "./package.ts";
import { DEFAULT_ZIP_LIMITS, type ZipLimits, ZipArchive } from "./zip.ts";

export const MAX_DOCUMENTS = 2_000;
export const MAX_CHUNKS = 200;
export const MAX_TOTAL_CHARS = 2_500_000;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

export interface ParseOptions {
  filename: string;
  maxChunkChars?: number;
  limits?: ZipLimits;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fileStem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export async function parseEpub(
  bytes: Uint8Array,
  options: ParseOptions,
): Promise<NormalizedCourse> {
  const zip = ZipArchive.open(bytes, options.limits ?? DEFAULT_ZIP_LIMITS);
  const pkg = await readPackage(zip);
  const warnings = [...pkg.warnings];

  const tocTitleByPath = new Map<string, string>();
  for (const entry of pkg.toc) {
    if (entry.path && entry.title && !tocTitleByPath.has(entry.path)) {
      tocTitleByPath.set(entry.path, entry.title);
    }
  }

  if (pkg.spine.length > MAX_DOCUMENTS) {
    throw new ImportError("too_much_content", "This course export has too many pages to read.");
  }

  const documents: IrDocument[] = [];
  let characters = 0;

  for (const item of pkg.spine) {
    if (!zip.has(item.path)) {
      warnings.push(`A page listed in the book is missing: ${item.path}`);
      continue;
    }
    let html: string;
    try {
      html = await zip.readText(item.path, MAX_PAGE_BYTES);
    } catch (error) {
      if (error instanceof ImportError && error.code !== "invalid_epub") throw error;
      warnings.push(`A page could not be read and was skipped: ${item.path}`);
      continue;
    }

    const page = extractBlocks(html);
    if (page.blocks.length === 0) continue;

    const title = tocTitleByPath.get(item.path) ?? page.heading ?? fileStem(item.path);
    if (/^(table of )?contents?$/i.test(title.trim())) continue;

    const pageChars = page.blocks.reduce((n, b) => n + b.text.length, 0);
    characters += pageChars;
    if (characters > MAX_TOTAL_CHARS) {
      throw new ImportError("too_much_content", "This course export is too large to read.");
    }

    documents.push({
      index: documents.length,
      id: item.id,
      path: item.path,
      title,
      blocks: page.blocks,
      wordCount: page.blocks.reduce((n, b) => n + countWords(b.text), 0),
    });
  }

  if (documents.length === 0) {
    throw new ImportError(
      "no_readable_content",
      "No readable text was found. The EPUB may be image-only or DRM-protected.",
    );
  }
  const words = documents.reduce((n, d) => n + d.wordCount, 0);
  if (zip.has("META-INF/encryption.xml") && words < 200) {
    warnings.push(
      "This EPUB has an encryption manifest and very little text; it may be protected.",
    );
  }

  const chunks = buildChunks(documents, { maxChars: options.maxChunkChars ?? 8_000 });
  if (chunks.length > MAX_CHUNKS) {
    throw new ImportError("too_much_content", "This course export is too large to read in one go.");
  }

  return {
    source: {
      kind: "epub",
      filename: options.filename,
      sha256: await sha256Hex(bytes),
      sizeBytes: bytes.byteLength,
    },
    metadata: pkg.metadata,
    toc: pkg.toc,
    chunks,
    warnings,
    stats: { documents: documents.length, chunks: chunks.length, characters, words },
  };
}

/** Plain text (a pasted syllabus, a text file, a PDF already turned into text) -> NormalizedCourse. */
export async function normalizeText(
  text: string,
  options: ParseOptions,
): Promise<NormalizedCourse> {
  const blocks = blocksFromText(text);
  if (blocks.length === 0) {
    throw new ImportError("no_readable_content", "No readable text was found in that file.");
  }
  const characters = blocks.reduce((n, b) => n + renderBlock(b).length, 0);
  if (characters > MAX_TOTAL_CHARS) {
    throw new ImportError("too_much_content", "That text is too large to read.");
  }
  const title = options.filename.replace(/\.[^.]+$/, "");
  const doc: IrDocument = {
    index: 0,
    id: "text",
    path: options.filename,
    title,
    blocks,
    wordCount: blocks.reduce((n, b) => n + countWords(b.text), 0),
  };
  const chunks = buildChunks([doc], { maxChars: options.maxChunkChars ?? 8_000 });
  if (chunks.length > MAX_CHUNKS) {
    throw new ImportError("too_much_content", "That text is too large to read in one go.");
  }
  const encoded = new TextEncoder().encode(text);
  return {
    source: {
      kind: "text",
      filename: options.filename,
      sha256: await sha256Hex(encoded),
      sizeBytes: encoded.byteLength,
    },
    metadata: {
      title,
      authors: [],
      language: null,
      publisher: null,
      identifier: null,
      published: null,
      description: null,
    },
    toc: [],
    chunks,
    warnings: [],
    stats: { documents: 1, chunks: chunks.length, characters, words: doc.wordCount },
  };
}
