import {
  createTRPCClient,
  createTRPCUntypedClient,
  httpLink,
} from "@trpc/client";
import type { AppRouter } from "@shepherdjerred/tracker/contract";

export function trackerUrl(value: string): string {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Tracker URL must be an HTTP(S) base URL without credentials, query, or fragment",
    );
  return url.toString().replace(/\/$/u, "");
}

function options(baseUrl: string, timeoutMs = 30_000) {
  return {
    links: [
      httpLink({
        url: `${trackerUrl(baseUrl)}/trpc`,
        fetch: async (url: string | URL, init) => {
          const response = await fetch(url, {
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
        },
      }),
    ],
  };
}

export function trackerClient(baseUrl: string, timeoutMs?: number) {
  return createTRPCClient<AppRouter>(options(baseUrl, timeoutMs));
}
export function trackerApi(baseUrl: string) {
  return createTRPCUntypedClient(options(baseUrl));
}
export type TrackerClient = ReturnType<typeof trackerClient>;
