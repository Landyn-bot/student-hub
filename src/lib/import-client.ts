/**
 * Browser side of the import-epub edge function.
 *
 * The browser sends the raw file (or already-readable text) and gets back a batch id. It never
 * parses the EPUB and never talks to a model: parsing and extraction happen on the server.
 */
import { FunctionsHttpError } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

const FUNCTION_NAME = "import-epub";

export type StartImportResult =
  { ok: true; batchId: string; reused: boolean } | { ok: false; code: string; message: string };

async function callFunction(
  body: File | Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<StartImportResult> {
  try {
    const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
      body,
      ...(headers ? { headers } : {}),
    });

    if (error) {
      if (error instanceof FunctionsHttpError) {
        const payload = (await error.context.json().catch(() => null)) as {
          code?: string;
          message?: string;
        } | null;
        return {
          ok: false,
          code: payload?.code ?? "internal",
          message: payload?.message ?? "Something went wrong while processing this file.",
        };
      }
      return {
        ok: false,
        code: "network",
        message: "Could not reach Syllo. Check your connection.",
      };
    }

    const result = data as { ok?: boolean; batchId?: string; reused?: boolean } | null;
    if (result?.ok && typeof result.batchId === "string") {
      return { ok: true, batchId: result.batchId, reused: result.reused === true };
    }
    return { ok: false, code: "internal", message: "The server sent back something unexpected." };
  } catch {
    return { ok: false, code: "network", message: "Could not reach Syllo. Check your connection." };
  }
}

/** Upload a Canvas course export. The server validates, parses and reads it. */
export function uploadEpub(file: File): Promise<StartImportResult> {
  return callFunction(file, { "x-filename": encodeURIComponent(file.name) });
}

/** Text that is already readable (pasted, a text file, or a PDF/screenshot read to text). */
export function uploadText(filename: string, text: string): Promise<StartImportResult> {
  return callFunction({ action: "text", filename, text });
}

/** Read again the sections of an import that failed or were not reached. */
export function resumeImport(batchId: string): Promise<StartImportResult> {
  return callFunction({ action: "resume", batchId });
}
