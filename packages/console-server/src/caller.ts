import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AnyTRPCRouter } from "@trpc/server";

export type ConsoleClientOptions = {
  /** The console's base URL, e.g. `http://golink.golink.svc.cluster.local:8080`. */
  readonly url: string;
  /** A machine token; sent as `Authorization: Bearer <token>`. */
  readonly token?: string;
  /** @default "/trpc" */
  readonly endpoint?: string;
  /** @default 30_000 */
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
};

/**
 * A typed tRPC client for a first-party caller outside the browser (toolkit,
 * Temporal, CI). Types flow from `AppRouter`, so no schema is repeated here.
 * Import it from `@shepherdjerred/console-server/caller`: it loads only
 * `@trpc/client`, never Hono.
 */
export function createConsoleClient<TRouter extends AnyTRPCRouter>(
  options: ConsoleClientOptions,
) {
  const base = options.url.replace(/\/+$/u, "");
  const endpoint = options.endpoint ?? "/trpc";
  const timeoutMs = options.timeoutMs ?? 30_000;
  const send = options.fetch ?? fetch;
  return createTRPCClient<TRouter>({
    links: [
      httpBatchLink<AnyTRPCRouter>({
        url: `${base}${endpoint}`,
        headers: () =>
          options.token === undefined
            ? {}
            : { authorization: `Bearer ${options.token}` },
        // tRPC's `ResponseEsque` is narrower than Bun's `Response`, so hand
        // it only what `httpBatchLink` reads (as toolkit's Tracker client does).
        fetch: async (url: string | URL, init) => {
          const response = await send(url, {
            ...init,
            signal: AbortSignal.timeout(timeoutMs),
          });
          return {
            status: response.status,
            ok: response.ok,
            headers: response.headers,
            json: async (): Promise<unknown> => response.json(),
            text: async () => response.text(),
            body: null,
          };
        },
      }),
    ],
  });
}
