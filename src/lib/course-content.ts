/**
 * Normalized course-content contract.
 *
 * This is the stable boundary between *any* source (EPUB today; Canvas API, PDF or DOCX
 * later) and the server-side analysis endpoint. The endpoint depends on this shape only,
 * never on the EPUB parser, so swapping or adding ingestion sources changes nothing
 * downstream. Likewise the browser only ever speaks this contract — no model or vendor
 * details leak into client code.
 */
import { z } from "zod";

import type { EpubChunk, ParsedEpub } from "@/lib/epub";

/* ------------------------------------------------------------------ */
/* Input: normalized course content                                    */
/* ------------------------------------------------------------------ */

export const courseContentMetadataSchema = z.object({
  title: z.string().nullable(),
  authors: z.array(z.string()),
  language: z.string().nullable(),
  publisher: z.string().nullable(),
  identifier: z.string().nullable(),
  published: z.string().nullable(),
  description: z.string().nullable(),
});

export const courseContentChapterSchema = z.object({
  index: z.number().int().min(0),
  title: z.string(),
  path: z.string(),
  wordCount: z.number().int().min(0),
});

/**
 * One unit of text sent to the model. Every provenance field travels with the chunk so
 * each extracted fact can be traced back to the exact place in the original document.
 */
export const courseContentChunkSchema = z.object({
  id: z.string().min(1),
  chapterIndex: z.number().int().min(0),
  chapterTitle: z.string(),
  /** Path of the chapter file inside the source document. */
  chapterPath: z.string(),
  part: z.number().int().min(1),
  totalParts: z.number().int().min(1),
  text: z.string().min(1),
});

export const courseContentPayloadSchema = z.object({
  sourceName: z.string().min(1).max(300),
  metadata: courseContentMetadataSchema,
  chapters: z.array(courseContentChapterSchema),
  chunks: z.array(courseContentChunkSchema).min(1).max(400),
  warnings: z.array(z.string()),
});

export type CourseContentMetadata = z.infer<typeof courseContentMetadataSchema>;
export type CourseContentChapter = z.infer<typeof courseContentChapterSchema>;
export type CourseContentChunk = z.infer<typeof courseContentChunkSchema>;
export type CourseContentPayload = z.infer<typeof courseContentPayloadSchema>;

/**
 * Adapter: parsed EPUB -> normalized payload.
 * The raw .epub file is never sent anywhere; only extracted text crosses the wire.
 */
export function toCourseContentPayload(
  sourceName: string,
  parsed: ParsedEpub,
  chunks: EpubChunk[],
): CourseContentPayload {
  const pathByChapterIndex = new Map(parsed.chapters.map((chapter) => [chapter.index, chapter.path]));

  return {
    sourceName,
    metadata: parsed.metadata,
    chapters: parsed.chapters.map((chapter) => ({
      index: chapter.index,
      title: chapter.title,
      path: chapter.path,
      wordCount: chapter.wordCount,
    })),
    chunks: chunks.map((chunk) => ({
      id: chunk.id,
      chapterIndex: chunk.chapterIndex,
      chapterTitle: chunk.chapterTitle,
      chapterPath: pathByChapterIndex.get(chunk.chapterIndex) ?? "",
      part: chunk.part,
      totalParts: chunk.totalParts,
      text: chunk.text,
    })),
    warnings: parsed.warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Output: extraction result                                           */
/* ------------------------------------------------------------------ */

/** Where an extracted fact came from. Attached to every item, never guessed. */
export const extractionSourceSchema = z.object({
  sourceName: z.string(),
  chapterIndex: z.number().int().min(0),
  chapterTitle: z.string(),
  chapterPath: z.string(),
  chunkId: z.string(),
  part: z.number().int().min(1),
  totalParts: z.number().int().min(1),
  /** Verbatim sentence(s) from the document that the item was read from. */
  sourceText: z.string(),
});

export type ExtractionSource = z.infer<typeof extractionSourceSchema>;

const nullableText = z.string().trim().min(1).nullable().catch(null);

/**
 * Items the model may return. Confidence is optional on purpose: if the model does not
 * supply one, the field is omitted rather than invented.
 */
const baseItem = {
  title: z.string().trim().min(1),
  description: nullableText.optional(),
  date: nullableText.optional(),
  confidence: z.number().min(0).max(1).optional(),
};

const assignmentItem = z.object({ ...baseItem, due_date: nullableText.optional() });
const datedItem = z.object(baseItem);
const gradingItem = z.object({
  ...baseItem,
  weight: nullableText.optional(),
});

/** What the model is asked to return, before provenance is attached server-side. */
export const modelExtractionSchema = z.object({
  course: z
    .object({
      course_code: nullableText,
      course_name: nullableText,
      instructor: nullableText,
      semester: nullableText,
    })
    .partial()
    .transform((course) => ({
      course_code: course.course_code ?? null,
      course_name: course.course_name ?? null,
      instructor: course.instructor ?? null,
      semester: course.semester ?? null,
    })),
  assignments: z.array(assignmentItem).default([]),
  exams: z.array(datedItem).default([]),
  quizzes: z.array(datedItem).default([]),
  projects: z.array(datedItem).default([]),
  readings: z.array(datedItem).default([]),
  important_dates: z.array(datedItem).default([]),
  grading: z.array(gradingItem).default([]),
  policies: z.array(datedItem).default([]),
  other_important_information: z.array(datedItem).default([]),
});

export type ModelExtraction = z.infer<typeof modelExtractionSchema>;

/** Keys of the extraction result that hold arrays of items. */
export const extractionListKeys = [
  "assignments",
  "exams",
  "quizzes",
  "projects",
  "readings",
  "important_dates",
  "grading",
  "policies",
  "other_important_information",
] as const;

export type ExtractionListKey = (typeof extractionListKeys)[number];

export type ExtractedItem = {
  title: string;
  description?: string | null;
  date?: string | null;
  due_date?: string | null;
  weight?: string | null;
  confidence?: number;
  source: ExtractionSource;
};

export type CourseExtraction = {
  course: {
    course_code: string | null;
    course_name: string | null;
    instructor: string | null;
    semester: string | null;
  };
} & Record<ExtractionListKey, ExtractedItem[]>;

export function emptyExtraction(): CourseExtraction {
  const lists = Object.fromEntries(extractionListKeys.map((key) => [key, []])) as Record<
    ExtractionListKey,
    ExtractedItem[]
  >;
  return {
    course: { course_code: null, course_name: null, instructor: null, semester: null },
    ...lists,
  };
}

/** Per-chunk outcome, so a partial failure never hides the chunks that did succeed. */
export type ChunkAnalysis = {
  chunkId: string;
  chapterIndex: number;
  chapterTitle: string;
  status: "ok" | "failed";
  itemCount: number;
  latencyMs: number;
  error?: string;
};

export type AnalyzeCourseContentResponse =
  | {
      ok: true;
      sourceName: string;
      model: string;
      extraction: CourseExtraction;
      chunkResults: ChunkAnalysis[];
      chunksAnalyzed: number;
      chunksFailed: number;
      latencyMs: number;
    }
  | {
      ok: false;
      sourceName: string;
      kind: string;
      error: string;
      latencyMs: number;
    };
