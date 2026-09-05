import { MutationCache, QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { trackMutationMeta } from "#src/lib/analytics.ts";

const HttpStatusErrorSchema = z.object({
  data: z.object({ httpStatus: z.number() }),
});

/**
 * The single QueryClient shared by the React tree (via QueryClientProvider) and
 * the data-router loaders (which prefetch through this same instance so the
 * component observers hydrate from cache). Constructed at module load — never
 * per-render — so the loader and hook layers key against one cache.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry once, but never for client errors — auth/permission/validation
      // failures (4xx) won't succeed on retry.
      retry: (failureCount, error) => {
        const parsed = HttpStatusErrorSchema.safeParse(error);
        if (parsed.success && parsed.data.data.httpStatus < 500) {
          return false;
        }
        return failureCount < 1;
      },
      staleTime: 30_000,
    },
  },
  mutationCache: new MutationCache({
    onSuccess: (data, _variables, _context, mutation) => {
      trackMutationMeta(mutation.meta, "success", data);
    },
    onError: (_error, _variables, _context, mutation) => {
      trackMutationMeta(mutation.meta, "error");
    },
  }),
});
