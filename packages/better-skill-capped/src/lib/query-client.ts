import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { z } from "zod";
import { MANIFEST_SCHEMA_VERSION } from "#src/parser/manifest";
import { QUERY_CACHE_KEY } from "#src/storage/keys";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      // A ZodError here means persisted manifest data no longer matches the
      // schema; drop the persisted cache so the next load refetches cleanly.
      if (error instanceof z.ZodError) {
        globalThis.localStorage.removeItem(QUERY_CACHE_KEY);
      }
    },
  }),
  defaultOptions: {
    queries: {
      // The manifest refreshes daily via a Temporal workflow; an hour of
      // staleness is fine and replaces the old hand-rolled 15-minute cache.
      staleTime: 60 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 2,
    },
  },
});

export const persistOptions = {
  persister: createAsyncStoragePersister({
    storage: globalThis.localStorage,
    key: QUERY_CACHE_KEY,
  }),
  maxAge: 24 * 60 * 60 * 1000,
  buster: MANIFEST_SCHEMA_VERSION,
  dehydrateOptions: {
    // Persist ONLY the manifest. Other queries (in-memory search results,
    // ddragon champion data with its Map) either don't survive JSON
    // round-trips or don't deserve localStorage space.
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] === "manifest",
  },
};
