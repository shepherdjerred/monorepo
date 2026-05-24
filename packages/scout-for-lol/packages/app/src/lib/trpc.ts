import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@scout-for-lol/backend/trpc/router/index.ts";

const CSRF_COOKIE = "scout_csrf";

function readCsrfCookie(): string | null {
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

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/trpc",
      fetch: (url, init) => {
        const headers = new Headers(init?.headers);
        const csrf = readCsrfCookie();
        if (csrf !== null) headers.set("X-CSRF-Token", csrf);
        const nextInit: RequestInit = {
          headers,
          credentials: "include",
        };
        if (init?.method !== undefined) nextInit.method = init.method;
        if (init?.body !== undefined && init.body !== null)
          nextInit.body = init.body;
        if (init?.signal !== undefined && init.signal !== null)
          nextInit.signal = init.signal;
        return fetch(url, nextInit);
      },
    }),
  ],
});

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();
