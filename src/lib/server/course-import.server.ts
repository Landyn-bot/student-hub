/**
 * Server-only writer for a confirmed import.
 *
 * This lives under `server/` on purpose. It reaches into conflict reconciliation, which talks
 * to the model, so it must never be reachable from a client bundle. Both the direct save and
 * the review screen's confirm step load it through a dynamic import inside a server handler.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { parseItemDate } from "@/lib/import-dates";
import type { ExistingItem } from "@/lib/server/conflicts.server";
import {
  reviewKinds,
  tableFor,
  type ReviewKind,
  type SaveCourseImportData,
  type SaveCourseImportItem,
  type SaveCourseImportResult,
  type SaveDecision,
} from "@/lib/semester-import.functions";

type Item = SaveCourseImportItem;

/** The four kinds of academic row an import can produce. */
type Kind = ReviewKind;

/** The date column belonging to each kind; policies carry no date. */
function dateUpdate(kind: Kind, date: string): Record<string, string> {
  if (kind === "assignment") return { due_date: date };
  if (kind === "exam") return { exam_date: date };
  if (kind === "event") return { starts_at: `${date}T00:00:00Z` };
  return {};
}

/** Low-confidence or unreadable timing is surfaced to the student instead of silently kept. */
const LOW_CONFIDENCE = 0.5;

function reviewFor(
  item: Item,
  ambiguousDate: boolean,
  reviewed: boolean,
): {
  review_status: "approved" | "needs_attention";
  needs_attention_reason: string | null;
} {
  if (reviewed) return { review_status: "approved", needs_attention_reason: null };
  if (ambiguousDate) {
    return { review_status: "needs_attention", needs_attention_reason: "Date could not be read" };
  }
  if (item.confidence !== undefined && item.confidence < LOW_CONFIDENCE) {
    return { review_status: "needs_attention", needs_attention_reason: "Low confidence" };
  }
  return { review_status: "approved", needs_attention_reason: null };
}

/**
 * The date for an item: what the model reported, or failing that the date literally written
 * in the sentence the item was quoted from. Nothing is inferred beyond what the text says.
 */
function dateFor(item: Item, year: number, preferDue: boolean, reviewed: boolean) {
  const stated = preferDue ? (item.due_date ?? item.date) : (item.date ?? item.due_date);
  const parsed = parseItemDate(stated, year);
  if (parsed.date !== null) return parsed;
  if ((stated ?? "").trim().length > 0) return parsed;
  // A reviewed item with no date is one the student left undated on purpose.
  if (reviewed) return { date: null, ambiguous: false };
  return parseItemDate(item.source.sourceText, year);
}

function referenceYearFrom(semester: string | null): number {
  const match = /(20\d{2})/.exec(semester ?? "");
  return match ? Number(match[1]) : new Date().getUTCFullYear();
}

/** Weights arrive as text ("30%"); only a plain number is stored. */
function numericWeight(value: string | null | undefined): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(value ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * Organises extracted, provenance-tagged items under their course and writes them, reconciling
 * each against what is already stored. Called by `saveCourseImport` and by the review screen's
 * confirm step.
 */
export async function persistCourseImport(
  supabase: SupabaseClient<Database>,
  userId: string,
  data: SaveCourseImportData,
): Promise<SaveCourseImportResult> {
  const extraction = data.extraction;
  const year = referenceYearFrom(extraction.course.semester);

  try {
    // Current semester, if the student set one during onboarding.
    const { data: term } = await supabase
      .from("terms")
      .select("id")
      .eq("user_id", userId)
      .eq("is_current", true)
      .limit(1)
      .maybeSingle();

    // The student's confirmed name comes first; only when it was skipped do we fall
    // back to whatever the model or the file called the course.
    const courseName =
      data.courseNameOverride ??
      extraction.course.course_name ??
      data.documentTitle ??
      data.sourceName.replace(/\.epub$/i, "");

    // Re-running the same upload updates it; a different source for a course we already have
    // (a second export, an announcement pack) joins that course instead of duplicating it.
    const courseCode = extraction.course.course_code?.trim() ?? "";
    let found: { id: string } | null = null;

    const byImport = await supabase
      .from("courses")
      .select("id")
      .eq("user_id", userId)
      .eq("external_id", data.importId)
      .maybeSingle();
    found = byImport.data ?? null;

    if (!found && courseCode.length > 0) {
      const byCode = await supabase
        .from("courses")
        .select("id")
        .eq("user_id", userId)
        .ilike("course_code", courseCode)
        .limit(1)
        .maybeSingle();
      found = byCode.data ?? null;
    }
    if (!found) {
      // Course titles differ between exports ("PHYS 0475 Intro Physics" vs "Intro Physics"),
      // so a close wording match counts as the same course.
      const { data: courses } = await supabase
        .from("courses")
        .select("id, name")
        .eq("user_id", userId);
      const { titleSimilarity } = await import("@/lib/server/conflicts.server");
      const close = (courses ?? [])
        .map((row) => ({ row, score: titleSimilarity(courseName, row.name) }))
        .sort((a, b) => b.score - a.score)[0];
      if (close && close.score >= 0.6) found = { id: close.row.id };
    }

    let courseId = found?.id ?? null;
    if (courseId) {
      await supabase
        .from("courses")
        .update({
          name: courseName,
          course_code: extraction.course.course_code,
          instructor: extraction.course.instructor,
        })
        .eq("id", courseId)
        .eq("user_id", userId);
    } else {
      const { data: inserted, error } = await supabase
        .from("courses")
        .insert({
          user_id: userId,
          term_id: term?.id ?? null,
          name: courseName,
          course_code: extraction.course.course_code,
          instructor: extraction.course.instructor,
          source: "epub_import",
          external_id: data.importId,
        })
        .select("id")
        .single();
      if (error || !inserted) throw error ?? new Error("Course could not be created");
      courseId = inserted.id;
    }

    // The imported document itself, kept whole so rejecting an item never loses its source.
    const { data: document, error: documentError } = await supabase
      .from("course_documents")
      .insert({
        user_id: userId,
        course_id: courseId,
        filename: data.sourceName,
        file_type: "application/epub+zip",
        processing_status: "completed",
        raw_text: data.documentText,
      })
      .select("id")
      .single();
    if (documentError || !document) throw documentError ?? new Error("Document not stored");

    // Drop only the rows a previous run of this same file produced. Rows that came from other
    // sources stay, so they can be compared against what this file says. Earlier documents
    // themselves are kept — source material is never removed.
    const { data: priorDocuments } = await supabase
      .from("course_documents")
      .select("id")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .eq("filename", data.sourceName)
      .neq("id", document.id);
    const priorIds = (priorDocuments ?? []).map((row) => row.id);
    if (priorIds.length > 0) {
      for (const table of [
        "assignments",
        "exams",
        "calendar_events",
        "course_policies",
        "class_meetings",
      ] as const) {
        await supabase
          .from(table)
          .delete()
          .eq("user_id", userId)
          .in("source_document_id", priorIds);
      }
    }

    /* ----- what this course already holds, for conflict detection ----- */

    const [existingAssignments, existingExams, existingEvents, existingPolicies] =
      await Promise.all([
        supabase
          .from("assignments")
          .select("id, title, due_date, source_text, source_document_id")
          .eq("user_id", userId)
          .eq("course_id", courseId)
          .neq("review_status", "rejected"),
        supabase
          .from("exams")
          .select("id, title, exam_date, source_text, source_document_id")
          .eq("user_id", userId)
          .eq("course_id", courseId)
          .neq("review_status", "rejected"),
        supabase
          .from("calendar_events")
          .select("id, title, starts_at, source_text, source_document_id")
          .eq("user_id", userId)
          .eq("course_id", courseId)
          .neq("review_status", "rejected"),
        supabase
          .from("course_policies")
          .select("id, title, source_text, source_document_id")
          .eq("user_id", userId)
          .eq("course_id", courseId)
          .neq("review_status", "rejected"),
      ]);

    const known: Record<Kind, ExistingItem[]> = {
      assignment: (existingAssignments.data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        date: row.due_date,
        sourceText: row.source_text,
        documentId: row.source_document_id,
      })),
      exam: (existingExams.data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        date: row.exam_date,
        sourceText: row.source_text,
        documentId: row.source_document_id,
      })),
      event: (existingEvents.data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        date: row.starts_at ? row.starts_at.slice(0, 10) : null,
        sourceText: row.source_text,
        documentId: row.source_document_id,
      })),
      policy: (existingPolicies.data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        date: null,
        sourceText: row.source_text,
        documentId: row.source_document_id,
      })),
    };

    /* ----- candidates from this document ----- */

    type Candidate = {
      kind: Kind;
      item: Item;
      date: string | null;
      ambiguous: boolean;
      extra: Record<string, unknown>;
    };

    const candidates: Candidate[] = [];

    for (const item of [...extraction.assignments, ...extraction.quizzes, ...extraction.projects]) {
      const parsed = dateFor(item, year, true, data.reviewed);
      candidates.push({
        kind: "assignment",
        item,
        date: parsed.date,
        ambiguous: parsed.date === null && parsed.ambiguous,
        extra: {
          description: item.description ?? null,
          due_date: parsed.date,
          due_time: item.time ?? null,
          points: item.points ?? null,
          weight: numericWeight(item.weight),
        },
      });
    }
    for (const item of extraction.exams) {
      const parsed = dateFor(item, year, false, data.reviewed);
      candidates.push({
        kind: "exam",
        item,
        date: parsed.date,
        ambiguous: parsed.date === null && parsed.ambiguous,
        extra: {
          description: item.description ?? null,
          exam_date: parsed.date,
          start_time: item.time ?? null,
          end_time: item.end_time ?? null,
          location: item.location ?? null,
          exam_type: item.subtype ?? null,
          weight: numericWeight(item.weight),
        },
      });
    }
    for (const item of [...extraction.important_dates, ...extraction.readings]) {
      const parsed = dateFor(item, year, false, data.reviewed);
      candidates.push({
        kind: "event",
        item,
        date: parsed.date,
        ambiguous: parsed.date === null && parsed.ambiguous,
        extra: {
          description: item.description ?? null,
          event_type: "event",
          all_day: true,
          starts_at: parsed.date ? `${parsed.date}T00:00:00Z` : null,
        },
      });
    }
    for (const { item, type } of [
      ...extraction.grading.map((item) => ({ item, type: "grading" })),
      ...extraction.policies.map((item) => ({ item, type: "general" })),
      ...extraction.other_important_information.map((item) => ({ item, type: "other" })),
    ]) {
      candidates.push({
        kind: "policy",
        item,
        date: null,
        ambiguous: false,
        extra: {
          policy_type: item.subtype ?? type,
          content: [item.description, item.weight].filter(Boolean).join(" · ") || null,
          parameters: item.parameters ?? null,
        },
      });
    }

    /* ----- reconcile each candidate against what is already known ----- */

    const { reconcileCandidate, conflictLimits } = await import("@/lib/server/conflicts.server");
    const budget = { remaining: conflictLimits.MAX_SEMANTIC_COMPARISONS };

    let needsAttention = 0;
    let itemsSaved = 0;
    let examsSaved = 0;
    let mergedCount = 0;
    let resolvedCount = 0;
    const decisions: SaveDecision[] = [];

    const logConflict = async (entry: {
      kind: Kind;
      itemId: string;
      resolution: string;
      existingValue: string | null;
      incomingValue: string | null;
      chosenValue: string | null;
      existingSourceText: string | null;
      incomingSourceText: string;
      detail: string;
    }) => {
      await supabase.from("item_conflicts").insert({
        user_id: userId,
        course_id: courseId,
        item_kind: entry.kind,
        item_id: entry.itemId,
        field: "date",
        resolution: entry.resolution,
        existing_value: entry.existingValue,
        incoming_value: entry.incomingValue,
        chosen_value: entry.chosenValue,
        existing_source_text: entry.existingSourceText,
        incoming_source_text: entry.incomingSourceText,
        incoming_document_id: document.id,
        detail: entry.detail,
      });
    };

    for (const candidate of candidates) {
      const decision = await reconcileCandidate(
        {
          title: candidate.item.title,
          date: candidate.date,
          sourceText: candidate.item.source.sourceText,
        },
        known[candidate.kind],
        budget,
      );

      // Record what the reconciliation decided, before acting on it.
      decisions.push({
        kind: candidate.kind,
        title: candidate.item.title,
        action: decision.kind === "attention" ? "attention" : decision.kind,
        date: candidate.date,
        detail:
          decision.kind === "insert"
            ? "New to this course — saved."
            : decision.kind === "attention"
              ? `${decision.reason}: ${decision.detail}`
              : decision.detail,
        sourceText: candidate.item.source.sourceText,
      });

      if (decision.kind === "insert") {
        const review = reviewFor(candidate.item, candidate.ambiguous, data.reviewed);
        if (review.review_status === "needs_attention") needsAttention += 1;
        const { data: inserted, error } = await supabase
          .from(tableFor[candidate.kind])
          .insert({
            user_id: userId,
            course_id: courseId,
            title: candidate.item.title,
            source_document_id: document.id,
            source_text: candidate.item.source.sourceText || null,
            source_section: candidate.item.source.section ?? null,
            source_chunk_key: candidate.item.source.chunkId,
            ai_generated: !candidate.item.userAdded,
            ai_confidence: candidate.item.confidence ?? null,
            edited_by_user: candidate.item.edited ?? false,
            ...review,
            ...candidate.extra,
          })
          .select("id")
          .single();
        if (error || !inserted) throw error ?? new Error("Item could not be saved");

        itemsSaved += 1;
        if (candidate.kind === "exam") examsSaved += 1;
        known[candidate.kind].push({
          id: inserted.id,
          title: candidate.item.title,
          date: candidate.date,
          sourceText: candidate.item.source.sourceText,
          documentId: document.id,
        });
        continue;
      }

      // From here on the item already exists; the source stays recorded either way.
      const stored = known[candidate.kind].find((row) => row.id === decision.existingId);

      if (decision.kind === "merge") {
        mergedCount += 1;
        if (decision.fillDate !== null) {
          await supabase
            .from(tableFor[candidate.kind])
            .update({
              ...dateUpdate(candidate.kind, decision.fillDate),
              review_status: "approved",
              needs_attention_reason: null,
            })
            .eq("id", decision.existingId)
            .eq("user_id", userId);
          if (stored) stored.date = decision.fillDate;
        }
        await logConflict({
          kind: candidate.kind,
          itemId: decision.existingId,
          resolution: decision.resolution,
          existingValue: decision.existingValue,
          incomingValue: decision.incomingValue,
          chosenValue: decision.fillDate ?? decision.existingValue,
          existingSourceText: decision.existingSourceText,
          incomingSourceText: candidate.item.source.sourceText,
          detail: decision.detail,
        });
        continue;
      }

      if (decision.kind === "supersede") {
        resolvedCount += 1;
        await supabase
          .from(tableFor[candidate.kind])
          .update({
            ...dateUpdate(candidate.kind, decision.newDate),
            source_text: candidate.item.source.sourceText,
            source_chunk_key: candidate.item.source.chunkId,
            source_document_id: document.id,
            review_status: "approved",
            needs_attention_reason: null,
          })
          .eq("id", decision.existingId)
          .eq("user_id", userId);
        if (stored) stored.date = decision.newDate;
        await logConflict({
          kind: candidate.kind,
          itemId: decision.existingId,
          resolution: "auto_resolved",
          existingValue: decision.existingValue,
          incomingValue: decision.newDate,
          chosenValue: decision.newDate,
          existingSourceText: decision.existingSourceText,
          incomingSourceText: candidate.item.source.sourceText,
          detail: decision.detail,
        });
        continue;
      }

      // Genuinely unresolved: the student is asked, and only here.
      needsAttention += 1;
      await supabase
        .from(tableFor[candidate.kind])
        .update({
          review_status: "needs_attention",
          needs_attention_reason: `${decision.reason} (${decision.existingValue ?? "unknown"} or ${
            decision.incomingValue ?? "unknown"
          })`,
        })
        .eq("id", decision.existingId)
        .eq("user_id", userId);
      await logConflict({
        kind: candidate.kind,
        itemId: decision.existingId,
        resolution: "needs_attention",
        existingValue: decision.existingValue,
        incomingValue: decision.incomingValue,
        chosenValue: null,
        existingSourceText: decision.existingSourceText,
        incomingSourceText: candidate.item.source.sourceText,
        detail: decision.detail,
      });
    }

    /* ----- the recurring weekly schedule ----- */

    let classMeetingsSaved = 0;
    if (data.classMeetings.length > 0) {
      const { data: existingMeetings } = await supabase
        .from("class_meetings")
        .select("weekday, start_time")
        .eq("user_id", userId)
        .eq("course_id", courseId)
        .neq("review_status", "rejected");
      const taken = new Set(
        (existingMeetings ?? []).map((row) => `${row.weekday}|${row.start_time ?? ""}`),
      );
      const rows: Database["public"]["Tables"]["class_meetings"]["Insert"][] = [];
      for (const meeting of data.classMeetings) {
        for (const weekday of meeting.weekdays) {
          const key = `${weekday}|${meeting.start_time ?? ""}`;
          if (taken.has(key)) continue;
          taken.add(key);
          rows.push({
            user_id: userId,
            course_id: courseId,
            title: meeting.title,
            weekday,
            start_time: meeting.start_time ?? null,
            end_time: meeting.end_time ?? null,
            location: meeting.location ?? null,
            source_document_id: document.id,
            source_text: meeting.source.sourceText || null,
            source_section: meeting.source.section ?? null,
            source_chunk_key: meeting.source.chunkId,
            ai_generated: !meeting.userAdded,
            ai_confidence: meeting.confidence ?? null,
            edited_by_user: meeting.edited ?? false,
            review_status: "approved",
          });
        }
      }
      if (rows.length > 0) {
        const { error } = await supabase.from("class_meetings").insert(rows);
        if (error) throw error;
        classMeetingsSaved = rows.length;
      }
    }

    // An item can be flagged on insert and then settled by a later chunk that merges or
    // supersedes it, so count what is actually still unresolved instead of trusting the
    // running tally.
    const attentionCounts = await Promise.all(
      reviewKinds.map(async (kind) => {
        const { count } = await supabase
          .from(tableFor[kind])
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("course_id", courseId)
          .eq("review_status", "needs_attention");
        return count ?? 0;
      }),
    );
    needsAttention = attentionCounts.reduce((sum, value) => sum + value, 0);

    console.log("[semester-import] saved", {
      userId,
      courseId,
      itemsSaved,
      mergedCount,
      resolvedCount,
      needsAttention,
    });

    return {
      ok: true,
      courseId,
      courseName,
      documentId: document.id,
      itemsSaved,
      examsSaved,
      classMeetingsSaved,
      merged: mergedCount,
      autoResolved: resolvedCount,
      needsAttention,
      decisions,
    };
  } catch (error) {
    console.error("[semester-import] save failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Your courses could not be saved. Try that file again." };
  }
}
