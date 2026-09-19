/**
 * Server-only conflict reconciliation for imported academic items.
 *
 * When two sources (a syllabus and a later announcement, or two uploads of the same course)
 * describe the same item, this decides between three outcomes:
 *
 *   duplicate   -> merge into the row we already have
 *   consistent  -> merge, filling in anything the earlier source left unknown
 *   conflicting -> take the value the sources say is current, or ask the student
 *
 * Titles are compared cheaply first; the model is only consulted for the narrow band where a
 * word overlap is neither clearly the same item nor clearly a different one.
 *
 * Reached only through a dynamic import inside a server handler, so the API key stays server-side.
 */
import { runNemotron } from "@/lib/nemotron.server";

/** An item we are about to save. */
export type ConflictCandidate = {
  title: string;
  /** ISO date, or null when the source never states one. */
  date: string | null;
  sourceText: string;
};

/** An item already stored for this course. */
export type ExistingItem = {
  id: string;
  title: string;
  date: string | null;
  sourceText: string | null;
  documentId: string | null;
};

export type ConflictDecision =
  | { kind: "insert" }
  | {
      kind: "merge";
      existingId: string;
      /** Set when the stored row had no date and this source supplies one. */
      fillDate: string | null;
      resolution: "duplicate" | "consistent";
      detail: string;
      existingValue: string | null;
      incomingValue: string | null;
      existingSourceText: string | null;
    }
  | {
      kind: "supersede";
      existingId: string;
      newDate: string;
      detail: string;
      existingValue: string | null;
      existingSourceText: string | null;
    }
  | {
      kind: "attention";
      existingId: string;
      reason: string;
      detail: string;
      existingValue: string | null;
      incomingValue: string | null;
      existingSourceText: string | null;
    };

/** Above this word overlap two titles are treated as the same item without asking the model. */
const SAME_TITLE = 0.85;
/** Below this they are treated as different items without asking the model. */
const DIFFERENT_TITLE = 0.5;
/** Hard cap on model comparisons per import, so a large upload cannot fan out. */
const MAX_SEMANTIC_COMPARISONS = 8;

const STOP_WORDS = new Set(["the", "a", "an", "of", "for", "and", "to", "in", "on", "is", "due"]);

function tokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 0 && !STOP_WORDS.has(word)),
  );
}

/** Word overlap between two titles, 0 (nothing shared) to 1 (identical wording). */
export function titleSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Wording that marks a source as announcing a change to something stated earlier. */
const UPDATE_LANGUAGE =
  /\b(moved|rescheduled|reschedule|updated|revised|new date|changed|change of|postponed|delayed|instead of|now on|note the change)\b/i;

const SEMANTIC_SYSTEM = [
  "You compare two short course-item descriptions from one college course.",
  'Answer with ONLY one word: "same" if both describe the same academic item,',
  '"different" if they are separate items. No punctuation, no explanation.',
].join(" ");

/**
 * Ask the model whether two borderline items are the same thing. Any failure is treated as
 * "not comparable", which keeps the item separate rather than silently merging.
 */
async function sameItemSemantically(a: ConflictCandidate, b: ExistingItem): Promise<boolean> {
  try {
    const result = await runNemotron({
      system: SEMANTIC_SYSTEM,
      user: [
        `Item A: ${a.title}`,
        `Context A: ${a.sourceText.slice(0, 300)}`,
        "",
        `Item B: ${b.title}`,
        `Context B: ${(b.sourceText ?? "").slice(0, 300)}`,
      ].join("\n"),
      maxTokens: 5,
      temperature: 0,
    });
    return /\bsame\b/i.test(result.text);
  } catch (error) {
    console.error("[conflicts] semantic comparison unavailable", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Decide what to do with one candidate given everything already stored for this course.
 * `budget` tracks the remaining model comparisons and is mutated as they are spent.
 */
export async function reconcileCandidate(
  candidate: ConflictCandidate,
  existingItems: ExistingItem[],
  budget: { remaining: number },
): Promise<ConflictDecision> {
  let match: ExistingItem | null = null;

  const scored = existingItems
    .map((item) => ({ item, score: titleSimilarity(candidate.title, item.title) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best && best.score >= SAME_TITLE) {
    match = best.item;
  } else if (best && best.score >= DIFFERENT_TITLE && budget.remaining > 0) {
    budget.remaining -= 1;
    if (await sameItemSemantically(candidate, best.item)) match = best.item;
  }

  if (!match) return { kind: "insert" };

  const existingValue = match.date;
  const incomingValue = candidate.date;

  // Duplicate wording with nothing new to add.
  if (incomingValue === null || incomingValue === existingValue) {
    return {
      kind: "merge",
      existingId: match.id,
      fillDate: null,
      resolution: incomingValue === existingValue ? "duplicate" : "consistent",
      detail: "Another source repeats this item without changing it.",
      existingValue,
      incomingValue,
      existingSourceText: match.sourceText,
    };
  }

  // The earlier source never stated a date; this one does, so they agree rather than clash.
  if (existingValue === null) {
    return {
      kind: "merge",
      existingId: match.id,
      fillDate: incomingValue,
      resolution: "consistent",
      detail: "A second source supplied the date the first one left out.",
      existingValue,
      incomingValue,
      existingSourceText: match.sourceText,
    };
  }

  // Two different dates for one item.
  const incomingAnnouncesChange = UPDATE_LANGUAGE.test(candidate.sourceText);
  const existingAnnouncesChange = UPDATE_LANGUAGE.test(match.sourceText ?? "");

  if (incomingAnnouncesChange && !existingAnnouncesChange) {
    return {
      kind: "supersede",
      existingId: match.id,
      newDate: incomingValue,
      detail: "A later source states this was moved, so the newer date is used.",
      existingValue,
      existingSourceText: match.sourceText,
    };
  }

  if (existingAnnouncesChange && !incomingAnnouncesChange) {
    return {
      kind: "merge",
      existingId: match.id,
      fillDate: null,
      resolution: "consistent",
      detail: "The stored date already comes from the source announcing the change.",
      existingValue,
      incomingValue,
      existingSourceText: match.sourceText,
    };
  }

  return {
    kind: "attention",
    existingId: match.id,
    reason: "Two sources give different dates",
    detail: "Neither source says which date is current.",
    existingValue,
    incomingValue,
    existingSourceText: match.sourceText,
  };
}

export const conflictLimits = { MAX_SEMANTIC_COMPARISONS };
