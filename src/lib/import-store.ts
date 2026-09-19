/**
 * In-memory record of the most recent import run, kept only for the developer debug view.
 *
 * Nothing here is persisted: it lives for the length of the browser session so the debug
 * page can show what was sent to the model, what the model returned and what was finally
 * stored, without re-uploading the file. No credentials or vendor details are involved.
 */
import type { ChunkTrace, CourseExtraction } from "@/lib/course-content";
import type { SaveDecision } from "@/lib/semester-import.functions";

export type ImportRunRecord = {
  importId: string;
  sourceName: string;
  courseName: string | null;
  finishedAt: number;
  chapters: number;
  chunks: number;
  /** One entry per chunk the model interpreted. */
  trace: ChunkTrace[];
  extraction: CourseExtraction | null;
  decisions: SaveDecision[];
};

const runs = new Map<string, ImportRunRecord>();

/** Store (or replace) the trace of one imported file. */
export function recordImportRun(record: ImportRunRecord): void {
  runs.set(record.importId, record);
}

/** Every run from this session, newest first. */
export function listImportRuns(): ImportRunRecord[] {
  return [...runs.values()].sort((a, b) => b.finishedAt - a.finishedAt);
}
