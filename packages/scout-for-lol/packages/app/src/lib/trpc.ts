import { createTRPCClient, httpBatchLink, splitLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@scout-for-lol/backend/trpc/router/index.ts";

const CSRF_COOKIE = "scout_csrf";

export function readCsrfCookie(): string | null {
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  if (match === undefined) return null;
  try {
    return decodeURIComponent(match.slice(CSRF_COOKIE.length + 1));
  } catch {
    return null;
  }
}

/** Attach the CSRF header + credentials to an outgoing tRPC request. Structural
 * param so both links' contextually-typed `fetch` inits pass through. */
function csrfInit(init: {
  headers?: HeadersInit | undefined;
  method?: string | undefined;
  body?: BodyInit | null | undefined;
  signal?: AbortSignal | null | undefined;
}): RequestInit {
  const headers = new Headers(init.headers);
  const csrf = readCsrfCookie();
  if (csrf !== null) headers.set("X-CSRF-Token", csrf);
  const nextInit: RequestInit = { headers, credentials: "include" };
  if (init.method !== undefined) nextInit.method = init.method;
  if (init.body !== undefined && init.body !== null) nextInit.body = init.body;
  if (init.signal !== undefined && init.signal !== null)
    nextInit.signal = init.signal;
  return nextInit;
}

// The report preview query accepts up to 4,000 characters of ScoutQL. As a
// query it would normally travel in the GET URL, where a long (percent-encoded)
// input can exceed intermediary URL limits (Cloudflare Tunnel / Caddy) and be
// rejected before reaching the resolver. Route only that procedure through a
// POST-override link so its large input stays in the request body; every other
// query keeps the default GET batching. (The server enables
// `allowMethodOverride` to accept POSTed queries.)
export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.path === "report.previewQuery",
      true: httpBatchLink({
        url: "/trpc",
        methodOverride: "POST",
        fetch: (url, init) => fetch(url, csrfInit(init ?? {})),
      }),
      false: httpBatchLink({
        url: "/trpc",
        fetch: (url, init) => fetch(url, csrfInit(init ?? {})),
      }),
    }),
  ],
});

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
