import type { getFetch } from "@trpc/client";

type FetchEsque = ReturnType<typeof getFetch>;

/**
 * The `fetch` for toolkit's tRPC HTTP links: every request is bounded by
 * `timeoutMs`, and the body is read through `json()`/`text()` only, so the
 * response stream is never held.
 */
export function timedFetch(timeoutMs: number): FetchEsque {
  return async (target: string | URL | Request, init) => {
    const response = await fetch(target, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      json: (): Promise<unknown> => response.json(),
      text: () => response.text(),
      body: null,
    };
  };
}
