// Import Semester: the production-facing workflow for bringing a semester of Canvas course
// exports into Syllo. Each .epub is uploaded, parsed, analysed, organized and saved end to
// end without asking the student to approve every extracted item. Only genuinely unresolved
// items (unreadable dates, low confidence) are surfaced afterwards.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/app-button";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import { analyzeCourseContentStructured } from "@/lib/course-analysis.functions";
import { extractionListKeys, type CourseExtraction } from "@/lib/course-content";
import {
  CourseImportError,
  createImportId,
  importErrorMessages,
  normalizeEpubImport,
  toAnalysisPayload,
  toImportErrorCode,
  type ImportErrorCode,
  type NormalizedCourseImport,
} from "@/lib/course-import";
import {
  bulkApproveItems,
  listAttentionItems,
  reviewImportedItem,
  type AttentionItem,
} from "@/lib/semester-import.functions";
import { chunkEpub, EpubParseError, parseEpub } from "@/lib/epub";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({
    meta: [
      { title: "Import Semester — Syllo" },
      {
        name: "description",
        content:
          "Drop in a semester of Canvas course exports and Syllo reads, organizes and saves your coursework automatically.",
      },
      { property: "og:title", content: "Import Semester — Syllo" },
      {
        property: "og:description",
        content:
          "Drop in a semester of Canvas course exports and Syllo reads, organizes and saves your coursework automatically.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ImportSemesterPage,
});

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

/** Each stage is distinct: a file is only "complete" once its coursework is saved. */
type ImportStatus = "uploading" | "parsing" | "analyzing" | "organizing" | "complete" | "failed";

type ImportFailure = { code: ImportErrorCode; message: string };

type CourseImport = {
  importId: string;
  file: File;
  fileName: string;
  fileSize: number;
  status: ImportStatus;
  normalized: NormalizedCourseImport | null;
  extraction: CourseExtraction | null;
  courseName: string | null;
  itemsSaved: number;
  examsSaved: number;
  needsAttention: number;
  error: ImportFailure | null;
};

const statusLabel: Record<ImportStatus, string> = {
  uploading: "Uploading",
  parsing: "Parsing",
  analyzing: "Analyzing",
  organizing: "Organizing",
  complete: "Complete",
  failed: "Failed",
};

const statusTone: Record<ImportStatus, string> = {
  uploading: "border-border text-foreground/60",
  parsing: "border-border text-foreground/60",
  analyzing: "border-border text-foreground/70",
  organizing: "border-border text-foreground/70",
  complete: "border-brand/40 bg-brand/5 text-foreground",
  failed: "border-destructive/40 bg-destructive/5 text-destructive",
};

const MAX_CHARS_PER_CHUNK = 12000;
/** How many files run through analysis at the same time. */
const ANALYSIS_CONCURRENCY = 2;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Turn anything thrown during parsing/normalizing into a predictable category. */
function toFailure(error: unknown): ImportFailure {
  if (error instanceof CourseImportError) return { code: error.code, message: error.message };
  if (error instanceof EpubParseError) return { code: "invalid_epub", message: error.message };
  return {
    code: "parser_failure",
    message: error instanceof Error ? error.message : importErrorMessages.parser_failure,
  };
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function ImportSemesterPage() {
  const analyze = useServerFn(analyzeCourseContentStructured);
  const save = useServerFn(
    // Imported lazily through the same module so the page keeps one server contract.
    (await import("@/lib/semester-import.functions")).saveCourseImport,
  );
  const [imports, setImports] = useState<CourseImport[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const patch = useCallback((importId: string, next: Partial<CourseImport>) => {
    setImports((prev) =>
      prev.map((item) => (item.importId === importId ? { ...item, ...next } : item)),
    );
  }, []);

  return null;
}
