/**
 * Date and time reading for model output. The model is asked for ISO dates and 24-hour times,
 * but models drift ("Oct 12", "11:59 PM"). Anything we can read with certainty is normalised;
 * anything else becomes null and is flagged, so an unknown date stays unknown.
 */

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export interface ParsedDate {
  /** ISO yyyy-mm-dd when the text names a real day. */
  date: string | null;
  /** True when the text looks like a date we could not pin down ("TBD", "week 4"). */
  ambiguous: boolean;
}

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  return candidate.toISOString().slice(0, 10);
}

function monthIndex(name: string): number {
  const lower = name.toLowerCase();
  if (lower.length < 3) return -1;
  const found = MONTHS.findIndex((month) => month.startsWith(lower.slice(0, 3)));
  return found === -1 ? -1 : found + 1;
}

export function parseDate(raw: string | null | undefined, referenceYear: number): ParsedDate {
  const text = (raw ?? "").trim();
  if (text.length === 0) return { date: null, ambiguous: false };

  const isoMatch = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (isoMatch) {
    const date = iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    if (date) return { date, ambiguous: false };
  }

  const monthFirst =
    /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?!\d)(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/.exec(text);
  if (monthFirst) {
    const month = monthIndex(monthFirst[1] ?? "");
    if (month > 0) {
      const date = iso(
        monthFirst[3] ? Number(monthFirst[3]) : referenceYear,
        month,
        Number(monthFirst[2]),
      );
      if (date) return { date, ambiguous: false };
    }
  }

  const dayFirst = /(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:\s+(\d{4}))?/.exec(
    text,
  );
  if (dayFirst) {
    const month = monthIndex(dayFirst[2] ?? "");
    if (month > 0) {
      const date = iso(
        dayFirst[3] ? Number(dayFirst[3]) : referenceYear,
        month,
        Number(dayFirst[1]),
      );
      if (date) return { date, ambiguous: false };
    }
  }

  const slash = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(text);
  if (slash) {
    const yearPart = slash[3];
    const year = yearPart
      ? Number(yearPart.length === 2 ? `20${yearPart}` : yearPart)
      : referenceYear;
    const date = iso(year, Number(slash[1]), Number(slash[2]));
    if (date) return { date, ambiguous: false };
  }

  return { date: null, ambiguous: true };
}

/** "23:59", "9:05", "11:59 PM", "noon" -> "HH:MM", or null. */
export function parseTime(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text === "noon") return "12:00";
  if (text === "midnight") return "23:59";
  const m =
    /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])\.?m?\.?$/.exec(text) ??
    /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? "0");
  const meridiem = m[3];
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "p" && hour !== 12) hour += 12;
    if (meridiem === "a" && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const WEEKDAYS: Record<string, number> = {
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7,
};

/** ISO weekday number (Monday = 1 ... Sunday = 7) for a name like "Tue", or null. */
export function parseWeekday(raw: string): number | null {
  return WEEKDAYS[raw.trim().toLowerCase().replace(/\.$/, "")] ?? null;
}

/**
 * Cheap hallucination guard: does the quoted sentence mention this date at all?
 * Accepts a written month or a numeric month together with the day number.
 */
export function quoteMentionsDate(quote: string, isoDate: string): boolean {
  const [, m, d] = isoDate.split("-").map(Number);
  if (!m || !d) return false;
  const text = quote.toLowerCase();
  const dayPresent = new RegExp(`(^|[^0-9])0?${d}(st|nd|rd|th)?([^0-9]|$)`).test(text);
  if (!dayPresent) return false;
  const name = MONTHS[m - 1]!;
  const monthWritten = new RegExp(`\\b${name.slice(0, 3)}[a-z]*\\b`).test(text);
  const monthNumeric =
    new RegExp(`(^|[^0-9])0?${m}\\s*[/.-]`).test(text) ||
    new RegExp(`[/.-]\\s*0?${m}([^0-9]|$)`).test(text);
  return monthWritten || monthNumeric;
}
