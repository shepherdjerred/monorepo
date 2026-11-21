import type { z } from "zod";
import { ErrorSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";

/** Why a request did not produce data. `reference` is the short trace id an operator searches for. */
export type ApiFailure = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly reference: string | null;
};

export type ApiResult<T> =
  | { readonly ok: true; readonly data: T; readonly reference: string | null }
  | { readonly ok: false; readonly failure: ApiFailure };

/** The first eight characters of a W3C trace id, or `null` when the header is absent or malformed. */
export function shortReference(traceId: string | null): string | null {
  return traceId !== null && /^[0-9a-f]{32}$/u.test(traceId)
    ? traceId.slice(0, 8)
    : null;
}

function failure(
  status: number,
  code: string,
  message: string,
  reference: string | null = null,
): { ok: false; failure: ApiFailure } {
  return { ok: false, failure: { status, code, message, reference } };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Fetches and validates one API response. Every outcome is a value: an aborted request, an
 * unreachable server, a typed error body and a response that breaks the shared contract each come
 * back as a failure with its own code, so callers render them instead of catching.
 */
export async function apiRequest<T>(
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError"
      ? failure(0, "aborted", "The request was cancelled.")
      : failure(0, "network", "Streambot could not be reached.");
  }
  const reference = shortReference(response.headers.get("x-trace-id"));
  const body = await readJson(response);
  if (!response.ok) {
    const parsed = ErrorSchema.safeParse(body);
    return parsed.success
      ? failure(
          response.status,
          parsed.data.code,
          parsed.data.message,
          reference,
        )
      : failure(response.status, "unavailable", "", reference);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // A response that does not match the shared contract is a bug, not a user error.
    console.error("Streambot response did not match its contract", url);
    return failure(response.status, "bad_response", "", reference);
  }
  return { ok: true, data: parsed.data, reference };
}

/** A JSON POST carrying the session's CSRF token. */
export function postJson(
  body: unknown,
  csrfToken: string,
  signal?: AbortSignal,
): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  };
}

/** `path?key=value…`, omitting empty values. */
export function apiUrl(
  path: string,
  params: Readonly<Record<string, string>>,
): string {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== ""),
  ).toString();
  return query === "" ? path : path + "?" + query;
}
