import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  FlagsArchiveResponseSchema,
  FlagsHistoryResponseSchema,
  FlagsMetadataResponseSchema,
  type FlagsHistoryResponse,
  type FlagsMetadataResponse,
} from "@shepherdjerred/feature-flags/flags-wire.ts";
import { readEndpoint } from "@shepherdjerred/flags/client/api.ts";

/*
 * The management-only audit views (`README.md`, Audit): a flag's history, a
 * deployment's inventory metadata and the archive of retired flags. Their
 * query keys start with `flags-` so they never match `["document", …]`,
 * which `useSummaryRefresh` watches.
 */

export type HistoryEntry = FlagsHistoryResponse["entries"][number];
export type FlagMetadata = FlagsMetadataResponse["flags"][number];

/** Entries per history page; "Load older" fetches the next page. */
export const HISTORY_PAGE_SIZE = 20;

function deploymentApi(catalog: string, stage: string): string {
  return `/v1/deployments/${encodeURIComponent(catalog)}/${encodeURIComponent(stage)}`;
}

function historyKey(catalog: string, stage: string, key: string) {
  return ["flags-history", catalog, stage, key] as const;
}

function metadataKey(catalog: string, stage: string) {
  return ["flags-metadata", catalog, stage] as const;
}

/** Inventory metadata, added time and last change for a deployment's keys. */
export function useFlagMetadata(catalog: string, stage: string) {
  return useQuery({
    queryKey: metadataKey(catalog, stage),
    queryFn: () =>
      readEndpoint(
        `${deploymentApi(catalog, stage)}/metadata`,
        FlagsMetadataResponseSchema,
      ),
    placeholderData: keepPreviousData,
  });
}

/**
 * One key's audit history, newest first, a page at a time. The key need not
 * be live: a retired flag's history is still served.
 */
export function useFlagHistory(catalog: string, stage: string, key: string) {
  return useInfiniteQuery({
    queryKey: historyKey(catalog, stage, key),
    // Audit ids are positive, so 0 asks for the newest page (no `before`).
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) });
      if (pageParam > 0) query.set("before", String(pageParam));
      return readEndpoint(
        `${deploymentApi(catalog, stage)}/flags/${encodeURIComponent(key)}/history?${query.toString()}`,
        FlagsHistoryResponseSchema,
      );
    },
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
}

/** Retired flags per deployment (`GET /v1/archive`). */
export function useArchive() {
  return useQuery({
    queryKey: ["flags-archive"],
    queryFn: () => readEndpoint("/v1/archive", FlagsArchiveResponseSchema),
  });
}

/**
 * Refetches a key's history and its deployment's metadata, for after a write
 * (or a conflict, which means someone else wrote) changes them.
 */
export function useRefreshFlagAudit(
  catalog: string,
  stage: string,
  key: string,
): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: historyKey(catalog, stage, key),
    });
    void queryClient.invalidateQueries({
      queryKey: metadataKey(catalog, stage),
    });
  };
}
