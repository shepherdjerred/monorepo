import { createTRPCClient, httpBatchLink, httpLink } from "@trpc/client";
import { QueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "#shared/contract.ts";

const url = `${location.origin}/trpc`;
export const api = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url })],
});
/**
 * Sends each call at once and lets it outlive the page, for work that must
 * still reach the server while the tab closes. Browsers cap such bodies at
 * 64 KiB, so this is for small mutations only.
 */
export const keepaliveApi = createTRPCClient<AppRouter>({
  links: [
    httpLink({
      url,
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: init?.signal ?? null,
          keepalive: true,
        }),
    }),
  ],
});
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5000, retry: 1 } },
});
type Output = inferRouterOutputs<AppRouter>;
export type BootstrapData = Output["meta"]["bootstrap"];
export type Issue = Output["issues"]["list"]["items"][number];
export type IssueDetailData = Output["issues"]["byIdentifier"];
export type EventData = Output["events"]["list"][number];
