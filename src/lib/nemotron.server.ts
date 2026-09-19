// Reusable server-only client for NVIDIA's hosted NIM API (Nemotron models).
// The future EPUB pipeline calls this the same way the developer test page does:
// EPUB parser -> normalized text -> analyzeCourseContent -> this service.
// The API key is read from a server environment secret and never leaves the server.

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b";

// Generous ceiling: large course readings can take a long time to analyse.
const REQUEST_TIMEOUT_MS = 180_000;

export type NemotronFailureKind =
  | "not_configured"
  | "unauthorized"
  | "rate_limited"
  | "timeout"
  | "network"
  | "upstream"
  | "malformed_response";

export class NemotronError extends Error {
  readonly kind: NemotronFailureKind;
  readonly status: number | undefined;

  constructor(kind: NemotronFailureKind, message: string, status?: number) {
    super(message);
    this.name = "NemotronError";
    this.kind = kind;
    this.status = status;
  }
}

export type NemotronRequest = {
  /** System instruction describing the analysis task. */
  system: string;
  /** Normalized course text to analyse. */
  user: string;
  temperature?: number;
  maxTokens?: number;
};

export type NemotronResult = {
  model: string;
  text: string;
  latencyMs: number;
  usage: { promptTokens: number | null; completionTokens: number | null } | null;
};

type NimChatCompletion = {
  model?: string;
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** Human-readable failure message for a kind; never contains credentials. */
function messageFor(kind: NemotronFailureKind, status?: number): string {
  switch (kind) {
    case "not_configured":
      return "The NVIDIA API key is not configured on the server.";
    case "unauthorized":
      return "NVIDIA rejected the request credentials.";
    case "rate_limited":
      return "NVIDIA is rate limiting requests right now. Try again shortly.";
    case "timeout":
      return "NVIDIA did not respond in time.";
    case "network":
      return "Could not reach the NVIDIA API.";
    case "malformed_response":
      return "NVIDIA returned a response Syllo could not read.";
    default:
      return `NVIDIA returned an error${status ? ` (status ${status})` : ""}.`;
  }
}

function classifyStatus(status: number): NemotronFailureKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  return "upstream";
}

/** Failures worth one more try: the service was momentarily busy or unreachable. */
const RETRYABLE: ReadonlySet<NemotronFailureKind> = new Set([
  "rate_limited",
  "network",
  "upstream",
]);
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_500;

/**
 * Sends one chat completion to Nemotron through the hosted NIM API.
 * Throws a NemotronError for every failure mode so callers can react by kind.
 * Transient failures (rate limits, 5xx, network blips) are retried a couple of times.
 */
export async function runNemotron(request: NemotronRequest): Promise<NemotronResult> {
  let lastError: NemotronError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestOnce(request);
    } catch (error) {
      if (!(error instanceof NemotronError)) throw error;
      const retryable =
        RETRYABLE.has(error.kind) &&
        (error.status === undefined || error.status >= 500 || error.status === 429);
      lastError = error;
      if (!retryable || attempt === MAX_ATTEMPTS) throw error;
      console.warn(`[nemotron] retrying after ${error.kind} (attempt ${attempt})`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }

  throw lastError ?? new NemotronError("network", messageFor("network"));
}

async function requestOnce(request: NemotronRequest): Promise<NemotronResult> {
  // Read the secret at call time; it must never be inlined into a client bundle.
  const apiKey = process.env["NVIDIA_API_KEY"];
  if (!apiKey) {
    throw new NemotronError("not_configured", messageFor("not_configured"));
  }

  const model = process.env["NVIDIA_NEMOTRON_MODEL"] || DEFAULT_MODEL;
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(`${NIM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 1200,
        stream: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    const kind: NemotronFailureKind = timedOut ? "timeout" : "network";
    // Logs the failure shape only — request body and credentials stay out of the log.
    console.error(`[nemotron] ${kind} after ${Date.now() - startedAt}ms`, {
      model,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw new NemotronError(kind, messageFor(kind));
  }

  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    const kind = classifyStatus(response.status);
    // Upstream error bodies describe the failure and never echo the key back.
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    console.error(`[nemotron] upstream ${response.status} after ${latencyMs}ms`, { model, detail });
    throw new NemotronError(kind, messageFor(kind, response.status), response.status);
  }

  let payload: NimChatCompletion;
  try {
    payload = (await response.json()) as NimChatCompletion;
  } catch {
    console.error(`[nemotron] unparsable JSON body after ${latencyMs}ms`, { model });
    throw new NemotronError("malformed_response", messageFor("malformed_response"));
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    console.error(`[nemotron] response missing text after ${latencyMs}ms`, {
      model,
      keys: Object.keys(payload ?? {}),
    });
    throw new NemotronError("malformed_response", messageFor("malformed_response"));
  }

  console.log(`[nemotron] ok in ${latencyMs}ms`, {
    model: payload.model ?? model,
    chars: content.length,
  });

  return {
    model: payload.model ?? model,
    text: content,
    latencyMs,
    usage: payload.usage
      ? {
          promptTokens: payload.usage.prompt_tokens ?? null,
          completionTokens: payload.usage.completion_tokens ?? null,
        }
      : null,
  };
}
