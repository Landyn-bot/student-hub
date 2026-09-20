/**
 * read-document: Syllo's own endpoint for PDFs, screenshots and photos of course material.
 *
 * The browser posts the file inline and receives plain text back. Which model reads the
 * document is a server-side detail the client never learns, exactly like course analysis.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** ~15 MB of file, base64-encoded, is the practical ceiling for one upload. */
const MAX_DATA_URL_CHARS = 21_000_000;

const ReadDocumentInput = z.object({
  fileName: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(120),
  dataUrl: z.string().min(16).max(MAX_DATA_URL_CHARS),
});

export type ReadDocumentResult =
  | { ok: true; text: string }
  | { ok: false; kind: string; error: string };

export const readDocumentText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReadDocumentInput.parse(input))
  .handler(async ({ data, context }): Promise<ReadDocumentResult> => {
    // Server-only import keeps the gateway client and its key out of the browser bundle.
    const { transcribeDocument, DocumentReadError } = await import(
      "@/lib/server/document-text.server"
    );

    console.log("[read-document] request", {
      userId: context.userId,
      fileName: data.fileName,
      mimeType: data.mimeType,
      encodedChars: data.dataUrl.length,
    });

    try {
      const text = await transcribeDocument(data);
      return { ok: true, text };
    } catch (error) {
      if (error instanceof DocumentReadError) {
        return { ok: false, kind: error.kind, error: error.message };
      }
      console.error("[read-document] unexpected failure", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, kind: "unknown", error: "We could not read that file." };
    }
  });
