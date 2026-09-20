// Browser-kept planner for students who have not made an account.
// Everything here lives in this one browser (localStorage) and never leaves it,
// apart from the short summary the assistant question carries to the model.
// Each function mirrors the signature of its signed-in counterpart so pages can
// swap between the two without knowing which they are using.
import type { AssistantChat, AssistantMessage, AssistantAnswer } from "@/lib/assistant.functions";
import type { Course, CourseInput } from "@/lib/courses.functions";
import type { FinanceTransaction } from "@/lib/finances.functions";
import type { FocusItem, FocusPlan } from "@/lib/focus.functions";
import { askAssistantGuest } from "@/lib/guest-assistant.functions";
import type { OnboardingState, PlanningStyle } from "@/lib/onboarding.functions";
import {
  isSitting,
  type ManualItemInput,
  type ManualItemKind,
  type PlannerCourse,
  type PlannerData,
  type PlannerItem,
  type UpdateManualItemInput,
} from "@/lib/planner.functions";
import type { Profile } from "@/lib/profile.functions";

const STORAGE_KEY = "syllo.guest.v1";

/** One item a guest added by hand. Imported files stay account-only. */
export type GuestItem = {
  id: string;
  kind: "assignment" | "exam";
  type: string;
  title: string;
  description: string | null;
  courseId: string | null;
  date: string | null;
  time: string | null;
  location: string | null;
  done: boolean;
  createdAt: string;
};

export type GuestData = {
  courses: Course[];
  items: GuestItem[];
  transactions: FinanceTransaction[];
  chat: AssistantMessage[];
  profile: { full_name: string | null; school: string | null };
  onboarding: {
    completed: boolean;
    term: { name: string; starts_on: string | null; ends_on: string | null } | null;
    preferences: {
      week_starts_on: number;
      default_reminder_hours: number;
      planning_style: PlanningStyle;
      email_reminders: boolean;
    };
  };
};

const EMPTY: GuestData = {
  courses: [],
  items: [],
  transactions: [],
  chat: [],
  profile: { full_name: null, school: null },
  onboarding: {
    completed: false,
    term: null,
    preferences: {
      week_starts_on: 1,
      default_reminder_hours: 24,
      planning_style: "balanced",
      email_reminders: false,
    },
  },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function readGuestData(): GuestData {
  if (typeof window === "undefined") return clone(EMPTY);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(EMPTY);
    const parsed = JSON.parse(raw) as Partial<GuestData>;
    return { ...clone(EMPTY), ...parsed };
  } catch {
    return clone(EMPTY);
  }
}

function write(data: GuestData): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked — the session keeps working, it just cannot persist.
  }
}

function mutate(change: (data: GuestData) => void): GuestData {
  const data = readGuestData();
  change(data);
  write(data);
  return data;
}

export function clearGuestData(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/** True when there is anything worth moving into a new account. */
export function guestDataCount(): number {
  const data = readGuestData();
  return data.courses.length + data.items.length + data.transactions.length;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `g-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function todayKey(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function daysUntil(date: string): number {
  const today = new Date(`${todayKey()}T00:00:00`).getTime();
  const target = new Date(`${date}T00:00:00`).getTime();
  return Math.round((target - today) / 86_400_000);
}

/* ------------------------------ planner ------------------------------ */

function toPlannerItem(item: GuestItem, courses: Course[]): PlannerItem {
  const course = courses.find((c) => c.id === item.courseId) ?? null;
  return {
    id: item.id,
    kind: item.kind,
    type: item.type,
    title: item.title,
    description: item.description,
    courseId: item.courseId,
    courseName: course?.name ?? null,
    date: item.date,
    time: item.time,
    location: item.location,
    sourceText: null,
    sourceName: null,
    aiGenerated: false,
    completable: item.kind === "assignment" && !isSitting(item.type),
    done: item.done,
  };
}

function toPlannerCourse(course: Course): PlannerCourse {
  return {
    id: course.id,
    name: course.name,
    courseCode: course.course_code,
    instructor: course.instructor,
  };
}

export async function getPlannerData(): Promise<PlannerData> {
  const data = readGuestData();
  return {
    courses: data.courses.map(toPlannerCourse),
    items: data.items.map((item) => toPlannerItem(item, data.courses)),
    classMeetings: [],
    attentionCount: 0,
  };
}

export async function setAssignmentDone(args: {
  data: { id: string; done: boolean };
}): Promise<{ ok: true }> {
  mutate((data) => {
    const item = data.items.find((row) => row.id === args.data.id);
    if (item) item.done = args.data.done;
  });
  return { ok: true };
}

/** Resolves the class an item belongs to, adding it when the student typed a new name. */
function resolveCourse(
  data: GuestData,
  courseId: string | null | undefined,
  courseName: string | null | undefined,
): string | null {
  if (courseId && data.courses.some((c) => c.id === courseId)) return courseId;
  const name = courseName?.trim();
  if (!name) return null;
  const existing = data.courses.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const created: Course = {
    id: newId(),
    name,
    course_code: null,
    instructor: null,
    credits: null,
    source: "manual",
  };
  data.courses.push(created);
  return created.id;
}

function kindToStored(kind: ManualItemKind): { kind: "assignment" | "exam"; type: string } {
  if (kind === "quiz" || kind === "exam") return { kind: "exam", type: kind };
  return { kind: "assignment", type: kind };
}

export async function addManualItem(args: { data: ManualItemInput }): Promise<{ ok: true }> {
  const input = args.data;
  if (!input.title.trim()) throw new Error("Give it a title.");
  mutate((data) => {
    const courseId = resolveCourse(data, input.courseId, input.courseName);
    const stored = kindToStored(input.kind);
    data.items.push({
      id: newId(),
      kind: stored.kind,
      type: stored.type,
      title: input.title.trim(),
      description: input.notes?.trim() ? input.notes.trim() : null,
      courseId,
      date: input.date,
      time: input.time?.trim() ? input.time.trim() : null,
      location: null,
      done: false,
      createdAt: new Date().toISOString(),
    });
  });
  return { ok: true };
}

export async function updateManualItem(args: {
  data: UpdateManualItemInput;
}): Promise<{ ok: true }> {
  const input = args.data;
  mutate((data) => {
    const item = data.items.find((row) => row.id === input.id);
    if (!item) return;
    const courseId = resolveCourse(data, input.courseId, input.courseName);
    const stored = kindToStored(input.kind);
    item.kind = stored.kind;
    item.type = stored.type;
    item.title = input.title.trim();
    item.description = input.notes?.trim() ? input.notes.trim() : null;
    item.courseId = courseId;
    item.date = input.date;
    item.time = input.time?.trim() ? input.time.trim() : null;
  });
  return { ok: true };
}

export async function deleteManualItem(args: {
  data: { id: string; kind: ManualItemKind };
}): Promise<{ ok: true }> {
  mutate((data) => {
    data.items = data.items.filter((row) => row.id !== args.data.id);
  });
  return { ok: true };
}

/* ------------------------------ courses ------------------------------ */

export async function listCourses(): Promise<Course[]> {
  return readGuestData().courses;
}

function cleanCourse(input: CourseInput) {
  const name = input.name.trim();
  if (!name || name.length > 160) throw new Error("Give the class a name.");
  return {
    name,
    course_code: input.courseCode?.trim() ? input.courseCode.trim() : null,
    instructor: input.instructor?.trim() ? input.instructor.trim() : null,
  };
}

export async function addCourse(args: { data: CourseInput }): Promise<Course> {
  const fields = cleanCourse(args.data);
  let created: Course | null = null;
  mutate((data) => {
    const existing = data.courses.find(
      (c) => c.name.toLowerCase() === fields.name.toLowerCase(),
    );
    if (existing) {
      created = existing;
      return;
    }
    created = { id: newId(), credits: null, source: "manual", ...fields };
    data.courses.push(created);
  });
  return created!;
}

export async function updateCourse(args: { data: CourseInput & { id: string } }): Promise<Course> {
  const fields = cleanCourse(args.data);
  let updated: Course | null = null;
  mutate((data) => {
    const course = data.courses.find((c) => c.id === args.data.id);
    if (!course) throw new Error("We could not find that class.");
    Object.assign(course, fields);
    updated = course;
  });
  return updated!;
}

/* ------------------------------ finances ------------------------------ */

export async function listTransactions(): Promise<FinanceTransaction[]> {
  return readGuestData().transactions;
}

export async function addTransaction(args: {
  data: {
    direction: "income" | "expense";
    category: string;
    description: string;
    occurredOn: string;
    amount: number;
  };
}): Promise<FinanceTransaction> {
  const row: FinanceTransaction = {
    id: newId(),
    direction: args.data.direction,
    category: args.data.category,
    description: args.data.description.trim(),
    occurredOn: args.data.occurredOn,
    amount: args.data.amount,
    currency: "USD",
    createdAt: new Date().toISOString(),
  };
  mutate((data) => {
    data.transactions.unshift(row);
  });
  return row;
}

export async function deleteTransaction(args: { data: { id: string } }): Promise<{ ok: true }> {
  mutate((data) => {
    data.transactions = data.transactions.filter((row) => row.id !== args.data.id);
  });
  return { ok: true };
}

/* --------------------------- profile / setup --------------------------- */

export async function getProfile(): Promise<Profile> {
  const data = readGuestData();
  return { id: "guest", full_name: data.profile.full_name, school: data.profile.school };
}

export async function updateProfile(args: {
  data: { full_name: string | null; school: string | null };
}): Promise<{ ok: true }> {
  mutate((data) => {
    data.profile = { full_name: args.data.full_name, school: args.data.school };
  });
  return { ok: true };
}

export async function getOnboardingState(): Promise<OnboardingState> {
  const data = readGuestData();
  return {
    completed: data.onboarding.completed,
    school: data.profile.school,
    term: data.onboarding.term,
    preferences: data.onboarding.preferences,
    reminder_email: null,
  };
}

export async function completeOnboarding(args: {
  data: {
    school: string;
    term_name: string;
    starts_on: string;
    ends_on: string;
    week_starts_on: number;
    default_reminder_hours: number;
    planning_style: PlanningStyle;
    email_reminders: boolean;
  };
}): Promise<{ ok: true }> {
  const input = args.data;
  mutate((data) => {
    data.profile.school = input.school.trim();
    data.onboarding = {
      completed: true,
      term: { name: input.term_name.trim(), starts_on: input.starts_on, ends_on: input.ends_on },
      preferences: {
        week_starts_on: input.week_starts_on,
        default_reminder_hours: input.default_reminder_hours,
        planning_style: input.planning_style,
        // Guests have no address on file, so email reminders stay off.
        email_reminders: false,
      },
    };
  });
  return { ok: true };
}

/* ------------------------------- focus ------------------------------- */

export async function getFocusPlan(): Promise<FocusPlan> {
  const data = readGuestData();
  const dated = data.items.filter((item) => item.date && !item.done);

  const scored = dated
    .map((item) => {
      const days = daysUntil(item.date!);
      const overdue = days < 0;
      const exam = item.kind === "exam";
      const score = (overdue ? 120 : 100 - days * 8) + (exam ? 25 : 0);
      return { item, days, overdue, exam, score };
    })
    .filter((row) => row.overdue || row.days <= 14)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const items: FocusItem[] = scored.map(({ item, days, overdue, exam }) => {
    const course = data.courses.find((c) => c.id === item.courseId) ?? null;
    const when = overdue
      ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} past its date`
      : days === 0
        ? "due today"
        : days === 1
          ? "due tomorrow"
          : `due in ${days} days`;
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      courseName: course?.name ?? null,
      date: item.date!,
      time: item.time,
      daysUntil: days,
      overdue,
      points: null,
      weight: null,
      reason: `${exam ? "A sitting" : "Work"} ${when}.`,
    };
  });

  return { items, explanationsUnavailable: true };
}

/* ------------------------------ assistant ------------------------------ */

export async function getAssistantChat(): Promise<AssistantChat> {
  return { conversationId: "guest", messages: readGuestData().chat };
}

/** Plain-text summary of the guest's own planner, capped before it is sent. */
function guestContext(data: GuestData): string {
  const lines = data.items.map((item) => {
    const course = data.courses.find((c) => c.id === item.courseId);
    return [
      item.type,
      item.title,
      course ? `for ${course.name}` : null,
      item.date ? `on ${item.date}` : "no date stated",
      item.time ? `at ${item.time}` : null,
      item.done ? "already done" : null,
      item.description,
    ]
      .filter(Boolean)
      .join(" — ");
  });
  const courses = data.courses.map((c) => `${c.name}${c.course_code ? ` (${c.course_code})` : ""}`);
  return [
    `CLASSES\n${courses.length > 0 ? courses.join("\n") : "(none added yet)"}`,
    `WORK AND SITTINGS\n${lines.length > 0 ? lines.join("\n") : "(none added yet)"}`,
  ]
    .join("\n\n")
    .slice(0, 12_000);
}

export async function askAssistant(args: { data: { question: string } }): Promise<AssistantAnswer> {
  const data = readGuestData();
  const question = args.data.question.trim().slice(0, 600);

  const history = data.chat.slice(-8).map((m) => ({ role: m.role, content: m.content }));
  const result = await askAssistantGuest({
    data: { question, context: guestContext(data), history },
  });

  mutate((current) => {
    current.chat.push({
      id: newId(),
      role: "user",
      content: question,
      createdAt: new Date().toISOString(),
    });
    if (result.ok) current.chat.push(result.answer);
  });

  return result;
}
