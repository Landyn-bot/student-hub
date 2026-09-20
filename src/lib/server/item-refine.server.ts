/**
 * Second interpretation pass over an extraction, run after the model has returned its JSON
 * and before anything is written to the student's semester.
 *
 * Two stages, deterministic first:
 *  1. Tidy: normalise titles, drop navigation/boilerplate rows, de-duplicate entries that
 *     say the same thing, and re-file obvious mis-categorisations from the wording.
 *  2. Semantic: one compact model call over titles alone (no raw document text) that may
 *     re-file an item or tidy its title. Anything it is unsure about keeps the original.
 *
 * It never invents a date, a description or an item, and every item keeps the exact source
 * sentence, chunk and document it came from.
 */
import type { SaveCourseImportData, SaveCourseImportItem } from "@/lib/semester-import.functions";

type Extraction = SaveCourseImportData["extraction"];
type Item = SaveCourseImportItem;

/** Lists an item may be re-filed between. Grading, policies and notes are left alone. */
const datedKeys = [
  "assignments",
  "exams",
  "quizzes",
  "projects",
  "readings",
  "important_dates",
] as const;
type DatedKey = (typeof datedKeys)[number];

/** Rows that are navigation or shell text, never actual coursework. */
const boilerplate =
  /^(course\s+home|home|syllabus|modules?|announcements?|welcome|table of contents|contents|introduction|overview|resources?|files?|grades?|pages?|instructor(\s+information)?|contact(\s+information)?|course\s+(information|description|schedule)|start here|getting started)$/i;

/** Leading labels a Canvas export tends to glue onto titles. */
const leadingLabel =
  /^(assignment|homework|hw|quiz|exam|test|midterm|final|project|reading|lab|discussion|module)\s*[:\-–—]\s+/i;

function tidyTitle(raw: string): string {
  let title = raw
    .replace(/\s+/g, " ")
    .replace(/^[\s•\-–—*·]+/, "")
    .replace(/[\s:;,.\-–—]+$/, "")
    .trim();
  // Only strip a label when something meaningful is left behind.
  const stripped = title.replace(leadingLabel, "").trim();
  if (stripped.length >= 4) title = stripped;
  return title.slice(0, 300);
}

function normalizeKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The list an item's own wording clearly belongs to, or null when the wording is neutral. */
function keyFromWording(title: string): DatedKey | null {
  const text = title.toLowerCase();
  if (/\bquiz(zes)?\b/.test(text)) return "quizzes";
  if (/\bproject\b|\bcapstone\b/.test(text)) return "projects";
  if (/\bexam\b|\bmidterm\b|\bfinal exam\b|\btest\b/.test(text)) return "exams";
  if (/\bread(ing)?\b|\bchapter\b|\btextbook\b/.test(text)) return "readings";
  if (/\bhomework\b|\bassignment\b|\bproblem set\b|\bpset\b|\blab report\b|\bessay\b/.test(text)) {
    return "assignments";
  }
  return null;
}

function statedDate(item: Item): string | null {
  return item.due_date ?? item.date ?? null;
}

/** Prefers the entry that actually carries a date and the longer description. */
function richer(a: Item, b: Item): Item {
  const aScore = (statedDate(a) ? 4 : 0) + (a.description?.length ?? 0) / 500 + (a.confidence ?? 0);
  const bScore = (statedDate(b) ? 4 : 0) + (b.description?.length ?? 0) / 500 + (b.confidence ?? 0);
  return bScore > aScore ? b : a;
}

/* ------------------------------------------------------------------ */
/* Stage 1 — deterministic tidy                                        */
/* ------------------------------------------------------------------ */

function tidy(extraction: Extraction): {
  extraction: Extraction;
  removed: number;
  refiled: number;
} {
  const buckets = new Map<DatedKey, Item[]>(datedKeys.map((key) => [key, []]));
  let removed = 0;
  let refiled = 0;

  for (const key of datedKeys) {
    for (const original of extraction[key]) {
      const title = tidyTitle(original.title);
      if (title.length < 3 || boilerplate.test(title)) {
        removed += 1;
        continue;
      }
      const item: Item = { ...original, title };
      const suggested = keyFromWording(title);
      const target = suggested ?? key;
      if (target !== key) refiled += 1;
      buckets.get(target)?.push(item);
    }
  }

  // De-duplicate across the dated lists: the same title and date said twice is one item.
  const seen = new Map<string, { key: DatedKey; index: number }>();
  const deduped = new Map<DatedKey, Item[]>(datedKeys.map((key) => [key, []]));
  for (const key of datedKeys) {
    for (const item of buckets.get(key) ?? []) {
      const fingerprint = `${normalizeKey(item.title)}|${statedDate(item) ?? ""}`;
      const previous = seen.get(fingerprint);
      const list = deduped.get(key);
      if (!list) continue;
      if (previous) {
        const kept = deduped.get(previous.key);
        const existing = kept?.[previous.index];
        if (kept && existing) kept[previous.index] = richer(existing, item);
        removed += 1;
        continue;
      }
      seen.set(fingerprint, { key, index: list.length });
      list.push(item);
    }
  }

  return {
    extraction: {
      ...extraction,
      assignments: deduped.get("assignments") ?? [],
      exams: deduped.get("exams") ?? [],
      quizzes: deduped.get("quizzes") ?? [],
      projects: deduped.get("projects") ?? [],
      readings: deduped.get("readings") ?? [],
      important_dates: deduped.get("important_dates") ?? [],
    },
    removed,
    refiled,
  };
}

/* ------------------------------------------------------------------ */
/* Stage 2 — one compact semantic pass                                 */
/* ------------------------------------------------------------------ */

const MAX_SEMANTIC_ITEMS = 60;

type Verdict = { type: DatedKey | "drop"; title?: string };

/**
 * Asks the model to confirm the category of each item and tidy obviously mangled titles.
 * Only titles, the current category and the quoted sentence are sent — never the document.
 */
async function classify(
  entries: { ref: string; key: DatedKey; item: Item }[],
): Promise<Map<string, Verdict>> {
  const { runNemotron } = await import("@/lib/nemotron.server");

  const lines = entries
    .map((entry) =>
      [
        `id=${entry.ref}`,
        `current=${entry.key}`,
        `title=${entry.item.title}`,
        `quoted=${(entry.item.source.sourceText || "").slice(0, 200).replace(/\s+/g, " ")}`,
      ].join(" | "),
    )
    .join("\n");

  const result = await runNemotron({
    system:
      "You sort a college course's extracted items into the right category. " +
      "Categories: assignments, exams, quizzes, projects, readings, important_dates. " +
      'Use "drop" only for navigation or boilerplate rows that are not real coursework. ' +
      "Never invent dates, items or details. Only clean a title when it is clearly mangled; " +
      "otherwise repeat it unchanged. " +
      'Reply with JSON only: {"items":[{"id":"...","type":"assignments","title":"..."}]} ' +
      "covering every id you were given.",
    user: lines,
    temperature: 0,
    maxTokens: 1200,
  });

  const match = /\{[\s\S]*\}/.exec(result.text);
  const verdicts = new Map<string, Verdict>();
  if (!match) return verdicts;

  const parsed: unknown = JSON.parse(match[0]);
  const list = (parsed as { items?: unknown }).items;
  if (!Array.isArray(list)) return verdicts;

  for (const raw of list) {
    const entry = raw as { id?: unknown; type?: unknown; title?: unknown };
    if (typeof entry.id !== "string") continue;
    const type = typeof entry.type === "string" ? entry.type : "";
    const valid = type === "drop" || (datedKeys as readonly string[]).includes(type);
    if (!valid) continue;
    const title = typeof entry.title === "string" ? tidyTitle(entry.title) : "";
    verdicts.set(entry.id, {
      type: type as DatedKey | "drop",
      ...(title.length >= 3 ? { title } : {}),
    });
  }
  return verdicts;
}

export type RefineSummary = {
  /** Rows removed as boilerplate or duplicates. */
  removed: number;
  /** Items moved into a different category. */
  refiled: number;
  /** True when the semantic pass could not run; the deterministic tidy still applied. */
  semanticUnavailable: boolean;
};

/**
 * Refines an extraction before it is saved. Falls back to the deterministic result alone if
 * the semantic pass fails — a model hiccup must never lose the student's real coursework.
 */
export async function refineExtraction(
  extraction: Extraction,
): Promise<{ extraction: Extraction; summary: RefineSummary }> {
  const first = tidy(extraction);
  let { removed, refiled } = first;
  let semanticUnavailable = false;

  const entries: { ref: string; key: DatedKey; item: Item }[] = [];
  for (const key of datedKeys) {
    for (const item of first.extraction[key]) {
      entries.push({ ref: `i${entries.length}`, key, item });
    }
  }

  if (entries.length === 0 || entries.length > MAX_SEMANTIC_ITEMS) {
    return { extraction: first.extraction, summary: { removed, refiled, semanticUnavailable } };
  }

  let verdicts = new Map<string, Verdict>();
  try {
    verdicts = await classify(entries);
    if (verdicts.size === 0) semanticUnavailable = true;
  } catch (error) {
    console.error("[refine] semantic pass failed", error);
    semanticUnavailable = true;
  }

  if (semanticUnavailable) {
    return { extraction: first.extraction, summary: { removed, refiled, semanticUnavailable } };
  }

  const buckets = new Map<DatedKey, Item[]>(datedKeys.map((key) => [key, []]));
  for (const entry of entries) {
    const verdict = verdicts.get(entry.ref);
    if (verdict?.type === "drop") {
      removed += 1;
      continue;
    }
    const target = verdict?.type ?? entry.key;
    if (target !== entry.key) refiled += 1;
    const item: Item = verdict?.title ? { ...entry.item, title: verdict.title } : entry.item;
    buckets.get(target)?.push(item);
  }

  return {
    extraction: {
      ...first.extraction,
      assignments: buckets.get("assignments") ?? [],
      exams: buckets.get("exams") ?? [],
      quizzes: buckets.get("quizzes") ?? [],
      projects: buckets.get("projects") ?? [],
      readings: buckets.get("readings") ?? [],
      important_dates: buckets.get("important_dates") ?? [],
    },
    summary: { removed, refiled, semanticUnavailable },
  };
}
