/**
 * Shared, deterministic ordering for academic work.
 *
 * One place decides what "most pressing" means, so the dashboard, the focus list and a
 * course overview all agree. Scores use stored facts only — dates, item kind and how
 * crowded a day is. Nothing here invents deadlines, points or workload.
 */
import { isSitting, type PlannerItem } from "@/lib/planner.functions";

/** Today as a local calendar day (YYYY-MM-DD), so "today" matches the student's own day. */
export function todayKey(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/** Whole days from one ISO day to another; negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * True when the item is genuinely late: handed-in work whose day has passed and which the
 * student has not checked off. Quizzes, tests and exams are sat on a fixed day, so once it
 * passes they are simply over — never "late".
 */
export function isOverdue(item: PlannerItem, today = todayKey()): boolean {
  if (!item.date || item.done) return false;
  if (item.kind === "exam" || isSitting(item.type) || isSitting(item.title)) return false;
  return item.date < today;
}

/** Weight per item kind: a sitting outranks ordinary hand-in work on the same day. */
function kindWeight(item: PlannerItem): number {
  if (item.kind === "exam" || isSitting(item.type)) return 25;
  if (/project/i.test(item.type)) return 12;
  if (/reading/i.test(item.type)) return -8;
  return 0;
}

/**
 * Higher score = more deserving of attention. Overdue work leads, then the nearest
 * deadlines, then the kind of work, then how busy that particular day already is.
 */
export function priorityScore(
  item: PlannerItem,
  options: { today?: string; sameDayCount?: number } = {},
): number {
  const today = options.today ?? todayKey();
  if (!item.date) return -50;
  if (item.done) return -100;

  const days = daysBetween(today, item.date);
  let score = isOverdue(item, today) ? 120 + Math.min(30, Math.abs(days)) : Math.max(0, 100 - days * 8);
  score += kindWeight(item);
  // A day carrying several deadlines deserves an earlier look than a quiet one.
  score += Math.min(10, Math.max(0, (options.sameDayCount ?? 1) - 1) * 3);
  return score;
}

/**
 * Orders a list by pressure, then by date and time so equal scores stay predictable.
 * Pure: the input array is never mutated.
 */
export function sortByPriority(items: PlannerItem[], today = todayKey()): PlannerItem[] {
  const perDay = new Map<string, number>();
  for (const item of items) {
    if (!item.date || item.done) continue;
    perDay.set(item.date, (perDay.get(item.date) ?? 0) + 1);
  }

  return [...items].sort((a, b) => {
    const scoreA = priorityScore(a, { today, sameDayCount: perDay.get(a.date ?? "") ?? 1 });
    const scoreB = priorityScore(b, { today, sameDayCount: perDay.get(b.date ?? "") ?? 1 });
    if (scoreA !== scoreB) return scoreB - scoreA;
    const dateOrder = (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31");
    if (dateOrder !== 0) return dateOrder;
    return (a.time ?? "").localeCompare(b.time ?? "");
  });
}
