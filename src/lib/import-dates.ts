/**
 * Date reading for imported course items.
 *
 * The model returns dates exactly as the document states them ("October 12", "10/12/2026",
 * "TBD"). Here we turn what we can into a real calendar date and flag the rest, so unknown
 * stays unknown instead of being guessed.
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

export type ParsedItemDate = {
  /** ISO yyyy-mm-dd when the text names a real day, otherwise null. */
  date: string | null;
  /** True when the text clearly refers to a date we could not read confidently. */
  ambiguous: boolean;
};

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  return candidate.toISOString().slice(0, 10);
}

function monthIndex(name: string): number {
  const lower = name.toLowerCase();
  const found = MONTHS.findIndex((month) => month.startsWith(lower.slice(0, 3)));
  return found === -1 ? -1 : found + 1;
}

/**
 * Read a date out of free text. `referenceYear` supplies the year when the document omits
 * it (typical for "October 12" in a semester schedule).
 */
export function parseItemDate(
  raw: string | null | undefined,
  referenceYear: number,
): ParsedItemDate {
  const text = (raw ?? "").trim();
  if (text.length === 0) return { date: null, ambiguous: false };

  // 2026-10-12
  const isoMatch = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (isoMatch) {
    const date = iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    if (date) return { date, ambiguous: false };
  }

  // October 12, 2026 / Oct 12
  const monthFirst = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?!\d)(?:\s*,?\s*(\d{4}))?/.exec(text);
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

  // 12 October 2026
  const dayFirst = /(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:\s+(\d{4}))?/.exec(text);
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

  // 10/12 or 10/12/2026 (US ordering, as used by Canvas course material)
  const slash = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(text);
  if (slash) {
    const yearPart = slash[3];
    const year = yearPart
      ? Number(yearPart.length === 2 ? `20${yearPart}` : yearPart)
      : referenceYear;
    const date = iso(year, Number(slash[1]), Number(slash[2]));
    if (date) return { date, ambiguous: false };
  }

  // Text that talks about timing but we could not pin down ("TBD", "week 4", "finals week").
  return { date: null, ambiguous: true };
}
