import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@shepherdjerred/artifacts/contract";

export const api = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `${location.origin}/trpc` })],
});

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5000, retry: 1 } },
});

type Output = inferRouterOutputs<AppRouter>;
export type InboxBoard = Output["inbox"]["list"]["boards"][number];
export type ArtifactDetail = Output["artifacts"]["get"];

export const keys = {
  inbox: ["inbox"] as const,
  board: (slug: string) => ["board", slug] as const,
  artifact: (id: string) => ["artifact", id] as const,
  versions: (artifactId: string) => ["versions", artifactId] as const,
  version: (id: string) => ["version", id] as const,
  boardThreads: (slug: string) => ["threads", "board", slug] as const,
  artifactThreads: (id: string) => ["threads", "artifact", id] as const,
  waiters: (scope: string) => ["waiters", scope] as const,
  pending: (scope: string) => ["pending", scope] as const,
};
