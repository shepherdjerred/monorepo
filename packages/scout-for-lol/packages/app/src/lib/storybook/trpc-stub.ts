import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import {
  createTRPCOptionsProxy,
  type TRPCOptionsProxy,
} from "@trpc/tanstack-react-query";
import type { AppRouter } from "@scout-for-lol/backend/trpc/router/index.ts";

/**
 * A transport that never settles.
 *
 * Stories have no backend, and there is no request mocking in this repo. A
 * request that hangs is the honest stand-in: an unseeded query stays pending
 * forever, so the story renders its loading state deterministically instead of
 * flashing a network error that no user would ever see.
 */
const neverSettles = async (): Promise<Response> =>
  new Promise<Response>(() => {
    // Intentionally never resolved.
  });

export const storyTrpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/trpc", fetch: neverSettles })],
});

export type StorySeed = (
  trpc: TRPCOptionsProxy<AppRouter>,
  queryClient: QueryClient,
) => void;

/**
 * Builds a QueryClient primed with whatever a story declared through the
 * `seedQueries` parameter.
 *
 * Seeds receive the same options proxy components use, so a seed writes its
 * data under `trpc.x.y.queryOptions(input).queryKey` rather than a hand-written
 * key — a hand-written key silently misses and the story shows a spinner.
 *
 * `staleTime: Infinity` and `retry: false` are load-bearing. Without them a
 * seeded query is considered stale on mount, refetches against the hanging
 * link, and drops straight back to its loading state.
 */
export function createStoryQueryClient(
  seeds: readonly StorySeed[],
): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
      },
    },
  });
  const trpc = createTRPCOptionsProxy<AppRouter>({
    client: storyTrpcClient,
    queryClient,
  });
  for (const seed of seeds) seed(trpc, queryClient);
  return queryClient;
}
