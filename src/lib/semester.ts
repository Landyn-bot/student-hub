// Typical U.S. college semester windows, used to pre-fill onboarding so the
// student only has to confirm (or adjust) the dates instead of typing them.

export type SemesterGuess = {
  name: string;
  startsOn: string;
  endsOn: string;
};

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Picks the semester that the given date falls in (or the one starting next),
 * using average U.S. academic-calendar dates.
 */
export function guessCurrentSemester(today: Date = new Date()): SemesterGuess {
  const year = today.getFullYear();
  const month = today.getMonth() + 1; // 1-12
  const day = today.getDate();

  // Spring runs mid-January through early May.
  if (month < 5 || (month === 5 && day <= 10)) {
    return { name: `Spring ${year}`, startsOn: isoDate(year, 1, 13), endsOn: isoDate(year, 5, 8) };
  }

  // Summer sessions run mid-May through mid-August.
  if (month < 8 || (month === 8 && day <= 14)) {
    return { name: `Summer ${year}`, startsOn: isoDate(year, 5, 19), endsOn: isoDate(year, 8, 8) };
  }

  // Fall runs late August through mid-December.
  if (month < 12 || (month === 12 && day <= 20)) {
    return { name: `Fall ${year}`, startsOn: isoDate(year, 8, 25), endsOn: isoDate(year, 12, 13) };
  }

  // Late December already belongs to the upcoming spring term.
  return {
    name: `Spring ${year + 1}`,
    startsOn: isoDate(year + 1, 1, 13),
    endsOn: isoDate(year + 1, 5, 8),
  };
}
