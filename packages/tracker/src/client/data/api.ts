import { createTRPCClient, httpBatchLink, httpLink } from "@trpc/client";
import { QueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "#shared/contract.ts";
import { CLIENT_REQUEST_ID_HEADER } from "#shared/contract.ts";
import { ownRequests } from "#client/live/request-ids.ts";
import { drafts } from "./drafts.ts";

type Call = { path: string; input: unknown };
/**
 * Name one outgoing request as this tab's. A draft being sent in it records
 * the ID, so it can be recognised should the page unload before the answer.
 */
function requestHeaders(calls: Call[]) {
  const requestId = ownRequests.next();
  drafts.stamp(calls, requestId);
  return { [CLIENT_REQUEST_ID_HEADER]: requestId };
}

const url = `${location.origin}/trpc`;
export const api = createTRPCClient<AppRouter>({
  // Each HTTP request, batched or not, names itself so the live stream can
  // tell this tab's own changes apart.
  links: [
    httpBatchLink({ url, headers: ({ opList }) => requestHeaders(opList) }),
  ],
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
      headers: ({ op }) => requestHeaders([op]),
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
