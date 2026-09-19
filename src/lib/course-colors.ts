/**
 * Stable course colors keep the same class recognizable everywhere it appears.
 * The palette uses semantic tokens from styles.css rather than page-level colors.
 */
const COURSE_PALETTES = [
  {
    solid: "bg-course-coral",
    soft: "bg-course-coral-soft",
    text: "text-course-coral-ink",
    border: "border-course-coral",
    ring: "ring-course-coral",
    hover: "hover:bg-course-coral-soft",
  },
  {
    solid: "bg-course-teal",
    soft: "bg-course-teal-soft",
    text: "text-course-teal-ink",
    border: "border-course-teal",
    ring: "ring-course-teal",
    hover: "hover:bg-course-teal-soft",
  },
  {
    solid: "bg-course-mustard",
    soft: "bg-course-mustard-soft",
    text: "text-course-mustard-ink",
    border: "border-course-mustard",
    ring: "ring-course-mustard",
    hover: "hover:bg-course-mustard-soft",
  },
  {
    solid: "bg-course-blue",
    soft: "bg-course-blue-soft",
    text: "text-course-blue-ink",
    border: "border-course-blue",
    ring: "ring-course-blue",
    hover: "hover:bg-course-blue-soft",
  },
  {
    solid: "bg-course-berry",
    soft: "bg-course-berry-soft",
    text: "text-course-berry-ink",
    border: "border-course-berry",
    ring: "ring-course-berry",
    hover: "hover:bg-course-berry-soft",
  },
  {
    solid: "bg-course-leaf",
    soft: "bg-course-leaf-soft",
    text: "text-course-leaf-ink",
    border: "border-course-leaf",
    ring: "ring-course-leaf",
    hover: "hover:bg-course-leaf-soft",
  },
] as const;

export type CoursePalette = (typeof COURSE_PALETTES)[number];

/** A small deterministic hash means a course keeps its color between sessions. */
export function coursePalette(courseId: string | null | undefined): CoursePalette {
  if (!courseId) return COURSE_PALETTES[0];

  let hash = 0;
  for (const character of courseId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return COURSE_PALETTES[hash % COURSE_PALETTES.length] ?? COURSE_PALETTES[0];
}
