/**
 * Turns a PDF, screenshot or photo of course material into plain text, server-side only.
 *
 * The browser never talks to a model provider: it posts the file to Syllo's own server
 * function, which calls the Lovable AI Gateway here and returns text. The extracted text
 * then travels the exact same route as EPUB text — normalize -> chunks -> analysis -> save —
 * so provenance and the existing pipeline stay unchanged.
 */

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/responses";
const MODEL = "openai/gpt-6-astra";

/** Predictable categories, mapped by the caller onto Syllo's import error codes. */
export type DocumentReadKind =
  | "not_configured"
  | "unauthorized"
  | "rate_limited"
  | "upstream"
  | "network"
  | "unsupported_file"
  | "no_readable_content";

export class DocumentReadError extends Error {
  readonly kind: DocumentReadKind;

  constructor(kind: DocumentReadKind, message: string) {
    super(message);
    this.name = "DocumentReadError";
    this.kind = kind;
  }
}

const INSTRUCTION = [
  "Transcribe this college course document into plain text for a study planner.",
  "Copy the wording exactly as it appears, including every date, due date, time, title,",
  "weight, point value and policy sentence. Keep the reading order and keep tables as",
  "readable lines. Do not summarise, do not translate and never invent anything that is",
  "not visible. If the page is unreadable, reply with the single word NOTHING.",
].join(" ");

function contentPart(mimeType: string, fileName: string, dataUrl: string) {
  if (mimeType.startsWith("image/")) {
    return { type: "input_image", image_url: dataUrl };
  }
  if (mimeType === "application/pdf") {
    return { type: "input_file", filename: fileName, file_data: dataUrl };
  }
  throw new DocumentReadError(
    "unsupported_file",
    "That file type cannot be read. Use a PDF, an image or a text file.",
  );
}

/** Reads one document and returns its transcribed text. Throws DocumentReadError on failure. */
export async function transcribeDocument(input: {
  fileName: string;
  mimeType: string;
  /** data:<mime>;base64,... — the file inlined, never a link to our own storage. */
  dataUrl: string;
}): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    throw new DocumentReadError("not_configured", "Document reading is not configured yet.");
  }

  const part = contentPart(input.mimeType, input.fileName, input.dataUrl);

  let response: Response;
  try {
    response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        reasoning: { effort: "low" },
        input: [{ role: "user", content: [{ type: "input_text", text: INSTRUCTION }, part] }],
      }),
    });
  } catch (error) {
    console.error("[document-text] network failure", {
      reason: error instanceof Error ? error.message : String(error),
    });
    throw new DocumentReadError("network", "We could not reach the reading service.");
  }

  if (!response.ok || !response.body) {
    // The upstream body is logged server-side only; the student sees a safe message.
    const detail = await response.text().catch(() => "");
    console.error("[document-text] upstream error", { status: response.status, detail });
    if (response.status === 401 || response.status === 403) {
      throw new DocumentReadError("unauthorized", "The reading service rejected the request.");
    }
    if (response.status === 429) {
      throw new DocumentReadError("rate_limited", "The reading service is busy. Try again shortly.");
    }
    throw new DocumentReadError("upstream", "The reading service is temporarily unavailable.");
  }

  // Responses API calls always stream; the deltas are joined into the final transcript.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event: unknown = JSON.parse(payload);
        const record = event as { type?: string; delta?: unknown };
        if (record.type === "response.output_text.delta" && typeof record.delta === "string") {
          text += record.delta;
        }
      } catch {
        // A partial or non-JSON keep-alive line is simply skipped.
      }
    }
  }

  const cleaned = text.trim();
  if (!cleaned || cleaned.toUpperCase() === "NOTHING") {
    throw new DocumentReadError(
      "no_readable_content",
      "No readable course text was found in that file.",
    );
  }
  return cleaned;
}
