/**
 * "What should I work on?" — a short, ranked view of the student's own upcoming work.
 *
 * Ranking is deterministic and based only on stored facts (days until due, overdue,
 * item kind, points/weight). Nemotron is used afterwards purely to phrase why each
 * item is highlighted; it is never allowed to add items, dates, points or workloads.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isSitting } from "@/lib/planner.functions";

export type FocusItem = {
  id: string;
  kind: "assignment" | "exam";
  title: string;
  courseName: string | null;
  /** ISO date (YYYY-MM-DD) — always taken from stored data. */
  date: string;
  time: string | null;
  /** Negative when the item is already past due. */
  daysUntil: number;
  overdue: boolean;
  points: number | null;
  weight: number | null;
  /** Short sentence explaining why this item is near the top. */
  reason: string;
};

export type FocusPlan = {
  items: FocusItem[];
  /** True when the explanations came from the deterministic fallback. */
  explanationsUnavailable: boolean;
};

const MAX_ITEMS = 4;
/** Only look a couple of weeks ahead — this is a short focus list, not a task manager. */
const HORIZON_DAYS = 14;

function todayKey(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function shortTime(value: string | null): string | null {
  if (!value) return null;
  return /^(\d{2}:\d{2})/.exec(value)?.[1] ?? null;
}

/** Higher score = more deserving of attention. Uses stored facts only. */
function scoreOf(item: Omit<FocusItem, "reason">): number {
  // Urgency dominates: today and overdue work outrank everything else.
  let score = item.overdue ? 120 : Math.max(0, 100 - item.daysUntil * 8);
  if (item.kind === "exam") score += 25;
  if (item.weight !== null) score += Math.min(25, item.weight);
  else if (item.points !== null) score += Math.min(15, item.points / 10);
  return score;
}

/** Plain, factual explanation used when the model is unavailable. */
function fallbackReason(item: Omit<FocusItem, "reason">): string {
  const when = item.overdue
    ? `${Math.abs(item.daysUntil)} day${Math.abs(item.daysUntil) === 1 ? "" : "s"} past due`
    : item.daysUntil === 0
      ? "due today"
      : item.daysUntil === 1
        ? "due tomorrow"
        : `due in ${item.daysUntil} days`;
  const weightNote =
    item.weight !== null
      ? `, worth ${item.weight}% of the grade`
      : item.points !== null
        ? `, worth ${item.points} points`
        : "";
  return `${item.kind === "exam" ? "Exam" : "Assignment"} ${when}${weightNote}.`;
}

/** Asks the model to phrase one short reason per item, strictly from the given facts. */
async function explain(items: Omit<FocusItem, "reason">[]): Promise<Map<string, string>> {
  const { runNemotron } = await import("@/lib/nemotron.server");
  const facts = items
    .map((item, index) =>
      [
        `${index + 1}. id=${item.id}`,
        `title: ${item.title}`,
        `course: ${item.courseName ?? "unknown"}`,
        `type: ${item.kind}`,
        `due: ${item.date}${item.time ? ` ${item.time}` : ""}`,
        `days until due: ${item.daysUntil}${item.overdue ? " (overdue)" : ""}`,
        `points: ${item.points ?? "unknown"}`,
        `weight: ${item.weight ?? "unknown"}`,
      ].join(" | "),
    )
    .join("\n");

  const result = await runNemotron({
    system:
      "You help a college student see why each piece of work matters right now. " +
      "Use ONLY the facts given. Never invent deadlines, grades, points, workloads or effort estimates. " +
      "If points or weight are unknown, do not mention them. " +
      'Reply with JSON only: {"reasons":[{"id":"...","reason":"..."}]} where each reason is one sentence under 18 words.',
    user: facts,
    temperature: 0,
    maxTokens: 400,
  });

  const match = /\{[\s\S]*\}/.exec(result.text);
  if (!match) return new Map();
  const parsed: unknown = JSON.parse(match[0]);
  const reasons = (parsed as { reasons?: unknown }).reasons;
  const map = new Map<string, string>();
  if (Array.isArray(reasons)) {
    for (const entry of reasons) {
      const id = (entry as { id?: unknown }).id;
      const reason = (entry as { reason?: unknown }).reason;
      if (typeof id === "string" && typeof reason === "string" && reason.trim()) {
        map.set(id, reason.trim());
      }
    }
  }
  return map;
}

/** The short focus list for the signed-in student. */
export const getFocusPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FocusPlan> => {
    const { supabase, userId } = context;
    const today = todayKey();

    const [assignments, exams] = await Promise.all([
      supabase
        .from("assignments")
        .select("id, title, due_date, due_time, points, weight, courses(name)")
        .eq("user_id", userId)
        .eq("review_status", "approved")
        .neq("status", "done")
        .not("due_date", "is", null),
      supabase
        .from("exams")
        .select("id, title, exam_date, start_time, points, weight, courses(name)")
        .eq("user_id", userId)
        .eq("review_status", "approved")
        .not("exam_date", "is", null),
    ]);

    const candidates: Omit<FocusItem, "reason">[] = [];

    const push = (
      kind: "assignment" | "exam",
      row: {
        id: string;
        title: string;
        date: string;
        time: string | null;
        points: number | null;
        weight: number | null;
        courses?: { name: string } | null;
      },
    ) => {
      const daysUntil = daysBetween(today, row.date);
      // Quizzes, tests and exams are sat on a fixed day: once that day passes they are
      // simply over, never "late". Only handed-in work can fall behind.
      const sitting = kind === "exam" || isSitting(row.title);
      if (daysUntil > HORIZON_DAYS || daysUntil < (sitting ? 0 : -14)) return;
      candidates.push({
        id: row.id,
        kind,
        title: row.title,
        courseName: row.courses?.name ?? null,
        date: row.date,
        time: shortTime(row.time),
        daysUntil,
        overdue: !sitting && daysUntil < 0,
        points: row.points,
        weight: row.weight,
      });
    };

    for (const row of assignments.data ?? []) {
      if (!row.due_date) continue;
      push("assignment", {
        id: row.id,
        title: row.title,
        date: row.due_date,
        time: row.due_time,
        points: row.points,
        weight: row.weight,
        courses: row.courses,
      });
    }

    for (const row of exams.data ?? []) {
      if (!row.exam_date) continue;
      push("exam", {
        id: row.id,
        title: row.title,
        date: row.exam_date,
        time: row.start_time,
        points: row.points,
        weight: row.weight,
        courses: row.courses,
      });
    }

    const ranked = candidates
      .sort((a, b) => scoreOf(b) - scoreOf(a) || a.date.localeCompare(b.date))
      .slice(0, MAX_ITEMS);

    if (ranked.length === 0) {
      return { items: [], explanationsUnavailable: false };
    }

    let reasons = new Map<string, string>();
    let explanationsUnavailable = false;
    try {
      reasons = await explain(ranked);
      if (reasons.size === 0) explanationsUnavailable = true;
    } catch (error) {
      // A model failure must never hide the student's real work.
      console.error("[focus] explanation failed", error);
      explanationsUnavailable = true;
    }

    return {
      items: ranked.map((item) => ({
        ...item,
        reason: reasons.get(item.id) ?? fallbackReason(item),
      })),
      explanationsUnavailable,
    };
  });
