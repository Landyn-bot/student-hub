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
  const pathByChapterIndex = new Map(
    parsed.chapters.map((chapter) => [chapter.index, chapter.path]),
  );

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

/**
 * Models are not always tidy: a category can come back as null, or one item in an
 * otherwise good list can be malformed. Drop only the entries that fail rather than
 * discarding the whole excerpt, and treat anything that is not a list as empty.
 */
function itemArray<T extends z.ZodTypeAny>(item: T) {
  return z
    .preprocess(
      (value) =>
        Array.isArray(value) ? value.filter((entry) => item.safeParse(entry).success) : [],
      z.array(item),
    )
    .default([]);
}

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
    .nullish()
    .transform((course) => ({
      course_code: course?.course_code ?? null,
      course_name: course?.course_name ?? null,
      instructor: course?.instructor ?? null,
      semester: course?.semester ?? null,
    })),
  assignments: itemArray(assignmentItem),
  exams: itemArray(datedItem),
  quizzes: itemArray(datedItem),
  projects: itemArray(datedItem),
  readings: itemArray(datedItem),
  important_dates: itemArray(datedItem),
  grading: itemArray(gradingItem),
  policies: itemArray(datedItem),
  other_important_information: itemArray(datedItem),
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
  description?: string | null | undefined;
  date?: string | null | undefined;
  due_date?: string | null | undefined;
  weight?: string | null | undefined;
  confidence?: number | undefined;
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
  const lists = Object.fromEntries(
    extractionListKeys.map((key) => [key, [] as ExtractedItem[]]),
  ) as unknown as Record<ExtractionListKey, ExtractedItem[]>;
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

/**
 * Developer-facing record of one semantic interpretation step: the deterministic text that
 * went in, the model's own reply, and the categories it produced. Used by the debug view to
 * show exactly where the model sits in the pipeline. It carries no vendor or key details.
 */
export type ChunkTrace = {
  chunkId: string;
  chapterIndex: number;
  chapterTitle: string;
  part: number;
  totalParts: number;
  status: "ok" | "failed";
  latencyMs: number;
  /** Text handed to the model, exactly as the deterministic parser produced it. */
  sourceText: string;
  /** The model's raw reply, truncated for transport. */
  modelReply: string;
  /** Validated categories, after Syllo's own schema check. */
  categories: { key: ExtractionListKey; titles: string[] }[];
  error?: string;
};

export type AnalyzeCourseContentResponse =
  | {
      ok: true;
      sourceName: string;
      model: string;
      extraction: CourseExtraction;
      chunkResults: ChunkAnalysis[];
      trace: ChunkTrace[];
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
