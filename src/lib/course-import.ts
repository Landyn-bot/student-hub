/**
 * Course import normalization layer.
 *
 * This is the stable internal contract between any ingestion source (the EPUB parser today;
 * Canvas, PDF or DOCX later) and the rest of Syllo. `src/lib/epub.ts` is never modified to
 * satisfy this layer: anything missing from the parser output (for example a chunk's source
 * path) is recovered here by linking the chunk back to its chapter.
 *
 * Nothing in this file is provider-aware. The browser normalizes, then posts the normalized
 * representation to Syllo's own server endpoint; NVIDIA details live server-side only.
 */
import { z } from "zod";

import { courseContentPayloadSchema, type CourseContentPayload } from "@/lib/course-content";
import type { EpubChunk, ParsedEpub } from "@/lib/epub";

/* ------------------------------------------------------------------ */
/* Error categories                                                     */
/* ------------------------------------------------------------------ */

/**
 * Predictable, user-presentable failure categories for the whole pipeline.
 * Client-side stages produce the first four; the server maps provider failures to the rest.
 */
export const importErrorCodes = [
  "invalid_epub",
  "parser_failure",
  "no_readable_content",
  "invalid_payload",
  "provider_not_configured",
  "provider_auth",
  "provider_rate_limited",
  "provider_timeout",
  "provider_unavailable",
  "malformed_model_response",
  "schema_validation_failure",
  "unknown",
] as const;

export type ImportErrorCode = (typeof importErrorCodes)[number];

/** Short, non-technical explanation shown next to a failure. Never leaks provider details. */
export const importErrorMessages: Record<ImportErrorCode, string> = {
  invalid_epub: "That file is not a readable EPUB.",
  parser_failure: "The file could not be read. It may be damaged or protected.",
  no_readable_content: "No readable text was found in this file.",
  invalid_payload: "The prepared content did not match the expected format.",
  provider_not_configured: "Course analysis is not configured on the server.",
  provider_auth: "The analysis service rejected the server's credentials.",
  provider_rate_limited: "The analysis service is busy. Try again shortly.",
  provider_timeout: "The analysis took too long and was stopped.",
  provider_unavailable: "The analysis service is temporarily unavailable.",
  malformed_model_response: "The analysis returned an unreadable result.",
  schema_validation_failure: "The analysis result did not match the expected structure.",
  unknown: "Something went wrong while processing this file.",
};

/** Error thrown by the client-side import stages (parse / normalize / validate). */
export class CourseImportError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message?: string) {
    super(message ?? importErrorMessages[code]);
    this.name = "CourseImportError";
    this.code = code;
  }
}

/** Map a server-reported failure kind onto an import error category. */
export function toImportErrorCode(kind: string): ImportErrorCode {
  switch (kind) {
    case "not_configured":
      return "provider_not_configured";
    case "unauthorized":
      return "provider_auth";
    case "rate_limited":
      return "provider_rate_limited";
    case "timeout":
      return "provider_timeout";
    case "network":
    case "upstream":
      return "provider_unavailable";
    case "malformed_response":
      return "malformed_model_response";
    case "schema_validation":
      return "schema_validation_failure";
    case "invalid_payload":
      return "invalid_payload";
    default:
      return (importErrorCodes as readonly string[]).includes(kind)
        ? (kind as ImportErrorCode)
        : "unknown";
  }
}

/* ------------------------------------------------------------------ */
/* Normalized representation                                            */
/* ------------------------------------------------------------------ */

export const importMetadataSchema = z.object({
  title: z.string().nullable(),
  authors: z.array(z.string()),
  language: z.string().nullable(),
  publisher: z.string().nullable(),
  identifier: z.string().nullable(),
  published: z.string().nullable(),
  description: z.string().nullable(),
});

export const importChapterSchema = z.object({
  chapterIndex: z.number().int().min(0),
  /** Stable within one import: `${importId}:ch:${chapterIndex}`. */
  chapterId: z.string().min(1),
  chapterTitle: z.string(),
  sourcePath: z.string(),
  wordCount: z.number().int().min(0),
});

export const importChunkSchema = z.object({
  /** Globally unique across imports: `${importId}:${localChunkId}`. */
  chunkKey: z.string().min(1),
  /** The parser's own id (e.g. "0-1"); unique only inside a single document. */
  localChunkId: z.string().min(1),
  chapterIndex: z.number().int().min(0),
  chapterTitle: z.string(),
  /** Recovered from the chapter, because EpubChunk does not carry it. */
  sourcePath: z.string(),
  part: z.number().int().min(1),
  totalParts: z.number().int().min(1),
  text: z.string().min(1),
});

export const normalizedCourseImportSchema = z.object({
  /** Identifies this one upload. Namespaces every chunk key. */
  importId: z.string().min(1),
  sourceName: z.string().min(1).max(300),
  metadata: importMetadataSchema,
  warnings: z.array(z.string()),
  chapters: z.array(importChapterSchema),
  chunks: z.array(importChunkSchema).min(1).max(400),
});

export type ImportMetadata = z.infer<typeof importMetadataSchema>;
export type ImportChapter = z.infer<typeof importChapterSchema>;
export type ImportChunk = z.infer<typeof importChunkSchema>;
export type NormalizedCourseImport = z.infer<typeof normalizedCourseImportSchema>;

/** New import id. Uses crypto.randomUUID when available, with a safe fallback. */
export function createImportId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `imp_${uuid}`;
}

/**
 * Parsed EPUB + chunks -> normalized import.
 *
 * Chunk source paths are recovered by linking `chunk.chapterIndex` to the matching entry in
 * `parsed.chapters`, so the parser stays untouched.
 */
export function normalizeEpubImport(
  sourceName: string,
  parsed: ParsedEpub,
  chunks: EpubChunk[],
  importId: string = createImportId(),
): NormalizedCourseImport {
  const chapterByIndex = new Map(parsed.chapters.map((chapter) => [chapter.index, chapter]));

  if (chunks.length === 0) {
    throw new CourseImportError("no_readable_content");
  }

  const candidate: NormalizedCourseImport = {
    importId,
    sourceName,
    metadata: parsed.metadata,
    warnings: parsed.warnings,
    chapters: parsed.chapters.map((chapter) => ({
      chapterIndex: chapter.index,
      chapterId: `${importId}:ch:${chapter.index}`,
      chapterTitle: chapter.title,
      sourcePath: chapter.path,
      wordCount: chapter.wordCount,
    })),
    chunks: chunks.map((chunk) => ({
      chunkKey: `${importId}:${chunk.id}`,
      localChunkId: chunk.id,
      chapterIndex: chunk.chapterIndex,
      chapterTitle: chunk.chapterTitle,
      sourcePath: chapterByIndex.get(chunk.chapterIndex)?.path ?? "",
      part: chunk.part,
      totalParts: chunk.totalParts,
      text: chunk.text,
    })),
  };

  const validated = normalizedCourseImportSchema.safeParse(candidate);
  if (!validated.success) {
    throw new CourseImportError("invalid_payload", importErrorMessages.invalid_payload);
  }
  return validated.data;
}

/**
 * Normalized import -> the payload the server analysis endpoint already accepts.
 * The globally unique chunk key travels as the chunk id, so provenance survives persistence.
 */
export function toAnalysisPayload(normalized: NormalizedCourseImport): CourseContentPayload {
  const payload = courseContentPayloadSchema.safeParse({
    sourceName: normalized.sourceName,
    metadata: normalized.metadata,
    chapters: normalized.chapters.map((chapter) => ({
      index: chapter.chapterIndex,
      title: chapter.chapterTitle,
      path: chapter.sourcePath,
      wordCount: chapter.wordCount,
    })),
    chunks: normalized.chunks.map((chunk) => ({
      id: chunk.chunkKey,
      chapterIndex: chunk.chapterIndex,
      chapterTitle: chunk.chapterTitle,
      chapterPath: chunk.sourcePath,
      part: chunk.part,
      totalParts: chunk.totalParts,
      text: chunk.text,
    })),
    warnings: normalized.warnings,
  });

  if (!payload.success) {
    throw new CourseImportError("invalid_payload");
  }
  return payload.data;
}
