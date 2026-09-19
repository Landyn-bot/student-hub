/**
 * Server-only Nemotron extraction utility.
 *
 * Isolates every NVIDIA-specific detail (prompting, JSON coaxing, per-chunk batching) so
 * React components and the EPUB parser never touch it. The HTTP client itself lives in
 * `src/lib/nemotron.server.ts`; this module turns normalized course content into a
 * validated, provenance-tagged extraction.
 *
 * This file is only ever reached through a dynamic import inside a server handler, so it
 * cannot end up in a client bundle and the API key stays on the server.
 */
import {
  emptyExtraction,
  extractionListKeys,
  modelExtractionSchema,
  type ChunkAnalysis,
  type CourseContentChunk,
  type CourseContentPayload,
  type CourseExtraction,
  type ExtractedItem,
  type ExtractionSource,
} from "@/lib/course-content";
import { NemotronError, runNemotron } from "@/lib/nemotron.server";

/** How many chunks are sent to the model at once. Keeps each prompt well inside context. */
const CHUNK_CONCURRENCY = 3;

const SYSTEM_PROMPT = [
  "You extract structured course information from one excerpt of a college course document.",
  "Return ONLY a JSON object, no prose and no code fences.",
  "Use exactly this shape:",
  '{"course":{"course_code":null,"course_name":null,"instructor":null,"semester":null},',
  '"assignments":[],"exams":[],"quizzes":[],"projects":[],"readings":[],',
  '"important_dates":[],"grading":[],"policies":[],"other_important_information":[]}',
  "Each item is an object with: title (required), description, date (ISO-8601 when a date is stated),",
  "and for assignments also due_date; for grading also weight.",
  'Add "source_text": the verbatim sentence from the excerpt the item came from.',
  "Never invent information. If a field is not stated in the excerpt, use null.",
  "If a category has nothing in this excerpt, return an empty array for it.",
  "Do not repeat information that is not in the excerpt you were given.",
].join(" ");

/** Pull the JSON object out of a model reply that may be wrapped in prose or fences. */
function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? text.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function sourceFor(
  payload: CourseContentPayload,
  chunk: CourseContentChunk,
  sourceText: unknown,
): ExtractionSource {
  return {
    sourceName: payload.sourceName,
    chapterIndex: chunk.chapterIndex,
    chapterTitle: chunk.chapterTitle,
    chapterPath: chunk.chapterPath,
    chunkId: chunk.id,
    part: chunk.part,
    totalParts: chunk.totalParts,
    sourceText: typeof sourceText === "string" ? sourceText.trim() : "",
  };
}

type ChunkOutcome = {
  analysis: ChunkAnalysis;
  items: Partial<Record<(typeof extractionListKeys)[number], ExtractedItem[]>>;
  course: CourseExtraction["course"];
  model: string | null;
};

/** Analyse a single chunk and validate the model's JSON against the extraction schema. */
async function analyzeChunk(
  payload: CourseContentPayload,
  chunk: CourseContentChunk,
): Promise<ChunkOutcome> {
  const startedAt = Date.now();
  const base: Pick<ChunkAnalysis, "chunkId" | "chapterIndex" | "chapterTitle"> = {
    chunkId: chunk.id,
    chapterIndex: chunk.chapterIndex,
    chapterTitle: chunk.chapterTitle,
  };

  const userPrompt = [
    `Document: ${payload.sourceName}`,
    payload.metadata.title ? `Document title: ${payload.metadata.title}` : null,
    `Section: ${chunk.chapterTitle} (part ${chunk.part} of ${chunk.totalParts})`,
    "",
    "Excerpt:",
    chunk.text,
  ]
    .filter((line) => line !== null)
    .join("\n");

  try {
    const result = await runNemotron({ system: SYSTEM_PROMPT, user: userPrompt });
    const raw = extractJsonObject(result.text);
    const parsed = modelExtractionSchema.safeParse(raw);

    if (!parsed.success) {
      console.error("[nemotron-extract] chunk returned unusable JSON", {
        chunkId: chunk.id,
        issue: parsed.error.issues[0]?.message ?? "invalid shape",
      });
      return {
        analysis: {
          ...base,
          status: "failed",
          itemCount: 0,
          latencyMs: Date.now() - startedAt,
          error: "The model did not return valid structured JSON for this section.",
        },
        items: {},
        course: { course_code: null, course_name: null, instructor: null, semester: null },
        model: result.model,
      };
    }

    // Attach provenance server-side; the model never gets to claim where a fact came from.
    const rawRecord = (raw ?? {}) as Record<string, unknown>;
    const items: ChunkOutcome["items"] = {};
    let itemCount = 0;

    for (const key of extractionListKeys) {
      const validated = parsed.data[key];
      const originals = Array.isArray(rawRecord[key]) ? (rawRecord[key] as unknown[]) : [];
      const mapped = validated.map((item, index) => {
        const original = (originals[index] ?? {}) as Record<string, unknown>;
        const mappedItem: ExtractedItem = {
          ...item,
          source: sourceFor(payload, chunk, original["source_text"]),
        };
        // Omit confidence entirely when the model did not provide one.
        if (mappedItem.confidence === undefined) delete mappedItem.confidence;
        return mappedItem;
      });
      if (mapped.length > 0) {
        items[key] = mapped;
        itemCount += mapped.length;
      }
    }

    return {
      analysis: { ...base, status: "ok", itemCount, latencyMs: Date.now() - startedAt },
      items,
      course: parsed.data.course,
      model: result.model,
    };
  } catch (error) {
    const message =
      error instanceof NemotronError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unexpected failure.";
    if (!(error instanceof NemotronError)) {
      console.error("[nemotron-extract] unexpected chunk failure", { chunkId: chunk.id });
    }
    return {
      analysis: {
        ...base,
        status: "failed",
        itemCount: 0,
        latencyMs: Date.now() - startedAt,
        error: message,
      },
      items: {},
      course: { course_code: null, course_name: null, instructor: null, semester: null },
      model: null,
    };
  }
}

export type ExtractionRun = {
  model: string;
  extraction: CourseExtraction;
  chunkResults: ChunkAnalysis[];
  chunksAnalyzed: number;
  chunksFailed: number;
};

/**
 * Multi-chunk aggregation: every chunk is analysed independently in small batches, then
 * merged. No chunk ever shares a prompt with another, so a document of any length stays
 * within the model's context window.
 */
export async function extractCourseContent(payload: CourseContentPayload): Promise<ExtractionRun> {
  const outcomes: ChunkOutcome[] = [];

  for (let i = 0; i < payload.chunks.length; i += CHUNK_CONCURRENCY) {
    const batch = payload.chunks.slice(i, i + CHUNK_CONCURRENCY);
    outcomes.push(...(await Promise.all(batch.map((chunk) => analyzeChunk(payload, chunk)))));
  }

  const extraction = emptyExtraction();
  let model = "";

  for (const outcome of outcomes) {
    if (outcome.model && !model) model = outcome.model;
    for (const key of extractionListKeys) {
      const list = outcome.items[key];
      if (list) extraction[key].push(...list);
    }
    // First stated value wins; fields never present stay null.
    extraction.course.course_code ??= outcome.course.course_code;
    extraction.course.course_name ??= outcome.course.course_name;
    extraction.course.instructor ??= outcome.course.instructor;
    extraction.course.semester ??= outcome.course.semester;
  }

  const chunkResults = outcomes.map((outcome) => outcome.analysis);
  const chunksFailed = chunkResults.filter((r) => r.status === "failed").length;

  return {
    model,
    extraction,
    chunkResults,
    chunksAnalyzed: chunkResults.length - chunksFailed,
    chunksFailed,
  };
}

/** Re-exported so callers can react to transport failures by kind. */
export { NemotronError };
