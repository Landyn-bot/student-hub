/**
 * Server-side client for NVIDIA's OpenAI-compatible chat endpoint (Nemotron models).
 * The API key is passed in by the caller from the function's environment; it is never logged,
 * returned, or included in an error message.
 */
import { ImportError, type ImportErrorCode } from "./errors.ts";

export interface NemotronConfig {
  apiKey: string | undefined;
  model?: string;
  baseUrl?: string;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Ask the endpoint for JSON mode. Retried without it if the endpoint rejects the parameter. */
  jsonMode?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResult {
  model: string;
  text: string;
  latencyMs: number;
}

export interface LlmClient {
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const MAX_ATTEMPTS = 4;

function classify(status: number): ImportErrorCode {
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 429) return "provider_rate_limited";
  return "provider_unavailable";
}

export function createNemotronClient(config: NemotronConfig): LlmClient {
  const fetchImpl = config.fetchImpl ?? fetch;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = config.model || DEFAULT_MODEL;
  let jsonMode = config.jsonMode ?? true;

  async function once(request: CompletionRequest): Promise<CompletionResult> {
    if (!config.apiKey) {
      throw new ImportError("provider_not_configured", "The NVIDIA API key is not configured.");
    }
    const started = Date.now();
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: request.messages,
          temperature: request.temperature ?? 0,
          max_tokens: request.maxTokens ?? 4096,
          stream: false,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(config.timeoutMs ?? 100_000),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new ImportError(
        timedOut ? "provider_timeout" : "provider_unavailable",
        timedOut ? "The analysis timed out." : "Could not reach the analysis service.",
      );
    }

    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 400);
      if (
        (response.status === 400 || response.status === 422) &&
        jsonMode &&
        /response_format/i.test(body)
      ) {
        jsonMode = false;
        return once(request);
      }
      const error = new ImportError(
        classify(response.status),
        `Upstream status ${response.status}`,
      );
      (error as ImportError & { retryAfterMs?: number }).retryAfterMs = retryAfter(response);
      throw error;
    }

    let payload: {
      model?: string;
      choices?: { message?: { content?: unknown }; finish_reason?: string }[];
    };
    try {
      payload = await response.json();
    } catch {
      throw new ImportError("malformed_model_response", "The analysis reply was not valid JSON.");
    }
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new ImportError("malformed_model_response", "The analysis reply was empty.");
    }
    return { model: payload.model ?? model, text: content, latencyMs: Date.now() - started };
  }

  return {
    async complete(request) {
      let last: ImportError | null = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          return await once(request);
        } catch (error) {
          if (!(error instanceof ImportError)) throw error;
          last = error;
          const retryable =
            error.code === "provider_rate_limited" || error.code === "provider_unavailable";
          if (!retryable || attempt === MAX_ATTEMPTS) throw error;
          const hinted = (error as ImportError & { retryAfterMs?: number }).retryAfterMs;
          await sleep(Math.min(hinted ?? 1_500 * 2 ** (attempt - 1), 20_000));
        }
      }
      throw last ?? new ImportError("provider_unavailable", "The analysis service is unavailable.");
    },
  };
}

function retryAfter(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}
