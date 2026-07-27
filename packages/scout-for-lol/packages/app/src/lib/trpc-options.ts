import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@scout-for-lol/backend/trpc/router/index.ts";
import { trpcClient } from "#src/lib/trpc.ts";
import { queryClient } from "#src/lib/query-client.ts";

/**
 * Context-free tRPC options proxy for use outside React — specifically the
 * data-router loaders, which prefetch queries before any component (and thus
 * any `useTRPC()` hook) mounts. It produces the identical query options/keys as
 * the in-React `useTRPC()` proxy because both wrap the same `trpcClient` and
 * `queryClient`, so a loader prefetch and a component's `useQuery` share a
 * cache entry.
 */
export const trpcOptions = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
