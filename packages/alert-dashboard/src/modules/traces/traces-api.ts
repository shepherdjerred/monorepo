import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
} from "@tanstack/react-query";
import {
  TraceDetailSchema,
  TracesFacetsResponseSchema,
  TracesSearchResponseSchema,
  type TraceRange,
  type TracesSearchQuery,
} from "@shepherdjerred/llm-observability/llm-traces";

import { fetchReportsJson } from "#client/reports/reports-api.ts";

export function buildTracesSearchParams(
  query: TracesSearchQuery,
  cursor?: string,
): string {
  const params = new URLSearchParams();
  if (query.source !== undefined) params.set("source", query.source);
  params.set("range", query.range);
  if (query.service !== undefined) params.set("service", query.service);
  if (query.environment !== undefined) {
    params.set("environment", query.environment);
  }
  if (query.workload !== undefined) params.set("workload", query.workload);
  if (query.provider !== undefined) params.set("provider", query.provider);
  if (query.model !== undefined) params.set("model", query.model);
  if (query.status !== "all") params.set("status", query.status);
  if (query.subjectId !== undefined) params.set("subjectId", query.subjectId);
  if (query.q !== undefined) params.set("q", query.q);
  if (cursor !== undefined) params.set("cursor", cursor);
  params.set("limit", String(query.limit));
  return `?${params.toString()}`;
}

export const tracesKeys = {
  all: ["traces"] as const,
  facets: (range: TraceRange) => [...tracesKeys.all, "facets", range] as const,
  searches: () => [...tracesKeys.all, "search"] as const,
  search: (query: TracesSearchQuery) =>
    [...tracesKeys.searches(), buildTracesSearchParams(query)] as const,
  detail: (traceId: string) => [...tracesKeys.all, "detail", traceId] as const,
};

const REFRESH_MS = 60_000;

export function tracesFacetsQuery(range: TraceRange) {
  return queryOptions({
    queryKey: tracesKeys.facets(range),
    queryFn: ({ signal }) =>
      fetchReportsJson(
        `/api/traces/facets?range=${encodeURIComponent(range)}`,
        TracesFacetsResponseSchema,
        signal,
      ),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
}

const INITIAL_CURSOR: string | undefined = undefined;

export function tracesSearchInfiniteQuery(query: TracesSearchQuery) {
  return infiniteQueryOptions({
    queryKey: tracesKeys.search(query),
    initialPageParam: INITIAL_CURSOR,
    queryFn: ({ pageParam, signal }) =>
      fetchReportsJson(
        `/api/traces/search${buildTracesSearchParams(query, pageParam)}`,
        TracesSearchResponseSchema,
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
}

export function traceDetailQuery(traceId: string) {
  return queryOptions({
    queryKey: tracesKeys.detail(traceId),
    queryFn: ({ signal }) =>
      fetchReportsJson(
        `/api/traces/${encodeURIComponent(traceId)}`,
        TraceDetailSchema,
        signal,
      ),
  });
}
