import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { QueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "#shared/contract.ts";

export const api = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `${location.origin}/trpc` })],
});
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5000, retry: 1 } },
});
type Output = inferRouterOutputs<AppRouter>;
export type BootstrapData = Output["meta"]["bootstrap"];
export type Issue = Output["issues"]["list"]["items"][number];
export type IssueDetailData = Output["issues"]["byIdentifier"];
export type EventData = Output["events"]["list"][number];
export const refresh = () => queryClient.invalidateQueries();
