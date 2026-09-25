import type { z } from "zod";

/** The `fetch` shape the clients need; injectable for tests. */
export type Fetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/** An upstream answered, but not with what the contract promised. */
export class UpstreamError extends Error {
  constructor(
    readonly upstream: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${upstream}: ${message}`);
    this.name = "UpstreamError";
  }
}

export type JsonRequest = {
  upstream: string;
  url: string | URL;
  init?: RequestInit;
  timeoutMs?: number;
  signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 15_000;

function combineSignals(
  timeoutMs: number,
  signal: AbortSignal | undefined,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([timeout, signal]);
}

/**
 * Fetch JSON and validate it. Non-2xx responses and schema mismatches both
 * throw `UpstreamError` with a bounded, body-free message so callers can
 * surface it without leaking upstream payloads.
 */
export async function fetchJson<T extends z.ZodType>(
  fetchImpl: Fetch,
  request: JsonRequest,
  schema: T,
): Promise<z.infer<T>> {
  const response = await fetchImpl(request.url, {
    ...request.init,
    signal: combineSignals(
      request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      request.signal,
    ),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new UpstreamError(
      request.upstream,
      `HTTP ${String(response.status)}`,
      response.status,
    );
  }
  const body: unknown = await response.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const paths = parsed.error.issues
      .slice(0, 3)
      .map((issue) => issue.path.join(".") || "(root)")
      .join(", ");
    throw new UpstreamError(
      request.upstream,
      `response did not match schema at ${paths}`,
    );
  }
  return parsed.data;
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
