export type ImportErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "not_found"
  | "file_too_large"
  | "not_zip"
  | "invalid_epub"
  | "unsafe_archive"
  | "drm_protected"
  | "no_readable_content"
  | "too_much_content"
  | "too_many_imports"
  | "provider_not_configured"
  | "provider_auth"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_unavailable"
  | "malformed_model_response"
  | "incomplete"
  | "internal";

const STATUS: Record<ImportErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  not_found: 404,
  file_too_large: 413,
  not_zip: 415,
  invalid_epub: 422,
  unsafe_archive: 422,
  drm_protected: 422,
  no_readable_content: 422,
  too_much_content: 413,
  too_many_imports: 429,
  provider_not_configured: 503,
  provider_auth: 502,
  provider_rate_limited: 503,
  provider_timeout: 504,
  provider_unavailable: 502,
  malformed_model_response: 502,
  incomplete: 504,
  internal: 500,
};

export class ImportError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

/** Messages here are shown to students, so they never include paths, keys or upstream bodies. */
export const PUBLIC_MESSAGES: Partial<Record<ImportErrorCode, string>> = {
  provider_not_configured: "Course analysis is not configured on the server yet.",
  provider_auth: "The analysis service rejected the server's credentials.",
  provider_rate_limited: "The analysis service is busy. Try again in a minute.",
  provider_timeout: "The analysis took too long and was stopped.",
  provider_unavailable: "The analysis service is temporarily unavailable.",
  malformed_model_response: "The analysis returned a result that could not be read.",
  internal: "Something went wrong while processing this file.",
};

export function publicMessage(error: unknown): { code: ImportErrorCode; message: string } {
  if (error instanceof ImportError) {
    return { code: error.code, message: PUBLIC_MESSAGES[error.code] ?? error.message };
  }
  return { code: "internal", message: PUBLIC_MESSAGES.internal ?? "Unexpected error." };
}
