import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";
import type { DigestKind } from "@shepherdjerred/ops-model/digest.ts";
import {
  FACET_SCHEMAS,
  type FacetByKey,
  type FacetKey,
} from "@shepherdjerred/ops-model/facets.ts";
import { SnapshotResponseSchema } from "@shepherdjerred/ops-model/snapshot.ts";

import {
  CursorResponseSchema,
  DigestReportSchema,
  OpsErrorSchema,
  OpsFacetsResponseSchema,
  opsFacetResponseSchema,
  SeriesResponseSchema,
  ServiceDetailSchema,
  type CursorResponse,
  type OpsError,
  type OpsFacetResponse,
  type SeriesPresetId,
  type SeriesRange,
} from "#shared/ops-schema";

const FACET_SCHEMA_BY_KEY: {
  readonly [K in FacetKey]: z.ZodType<FacetByKey[K]>;
} = FACET_SCHEMAS;

/** A typed failure from the ops API, carrying its machine-readable code. */
export class OpsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: OpsError["code"] | "http_error",
    message: string,
  ) {
    super(message);
    this.name = "OpsApiError";
  }
}

async function request<T extends z.ZodType>(
  path: string,
  schema: T,
  init?: RequestInit,
): Promise<z.infer<T>> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  const response = await fetch(path, { ...init, headers });
  const body: unknown = await response.json();
  if (!response.ok) {
    const typed = OpsErrorSchema.safeParse(body);
    throw typed.success
      ? new OpsApiError(response.status, typed.data.code, typed.data.error)
      : new OpsApiError(
          response.status,
          "http_error",
          `Request failed with HTTP ${String(response.status)}`,
        );
  }
  return schema.parse(body);
}

export function isSnapshotUnavailable(error: unknown): boolean {
  return error instanceof OpsApiError && error.code === "snapshot_unavailable";
}

const REFRESH_MS = 60_000;

export const opsKeys = {
  all: ["ops"] as const,
  snapshot: () => [...opsKeys.all, "snapshot"] as const,
  facets: () => [...opsKeys.all, "facets"] as const,
  facet: <K extends FacetKey>(key: K) =>
    [...opsKeys.all, "facets", key] as const,
};

export function snapshotQuery() {
  return queryOptions({
    queryKey: opsKeys.snapshot(),
    queryFn: ({ signal }) =>
      request("/api/v1/ops/snapshot?consumer=web", SnapshotResponseSchema, {
        signal,
      }),
    refetchInterval: REFRESH_MS,
  });
}

export function facetsQuery() {
  return queryOptions({
    queryKey: opsKeys.facets(),
    queryFn: ({ signal }) =>
      request("/api/v1/ops/facets", OpsFacetsResponseSchema, { signal }),
    refetchInterval: REFRESH_MS,
  });
}

export function facetQuery<K extends FacetKey>(key: K) {
  const ResponseSchema = opsFacetResponseSchema(key);
  return queryOptions({
    queryKey: opsKeys.facet(key),
    queryFn: async ({ signal }): Promise<OpsFacetResponse<K>> => {
      const parsed = await request(
        `/api/v1/ops/facets/${encodeURIComponent(key)}`,
        ResponseSchema,
        { signal },
      );
      return {
        ...parsed,
        data:
          parsed.data === null
            ? null
            : FACET_SCHEMA_BY_KEY[key].parse(parsed.data),
      };
    },
    refetchInterval: REFRESH_MS,
  });
}

export function serviceQuery(id: string) {
  return queryOptions({
    queryKey: [...opsKeys.all, "service", id] as const,
    queryFn: ({ signal }) =>
      request(
        `/api/v1/ops/services/${encodeURIComponent(id)}`,
        ServiceDetailSchema,
        { signal },
      ),
    refetchInterval: REFRESH_MS,
  });
}

export function seriesQuery(
  preset: SeriesPresetId,
  range: SeriesRange,
  target?: string,
) {
  const params = new URLSearchParams({ preset, range });
  if (target !== undefined) {
    params.set("target", target);
  }
  return queryOptions({
    queryKey:
      target === undefined
        ? ([...opsKeys.all, "series", preset, range] as const)
        : ([...opsKeys.all, "series", preset, range, target] as const),
    queryFn: ({ signal }) =>
      request(`/api/v1/ops/series?${params.toString()}`, SeriesResponseSchema, {
        signal,
      }),
    staleTime: REFRESH_MS,
    refetchInterval: 5 * REFRESH_MS,
  });
}

export function reviewQuery(kind: DigestKind) {
  return queryOptions({
    queryKey: [...opsKeys.all, "review", kind] as const,
    queryFn: ({ signal }) =>
      request(`/api/v1/ops/review?kind=${kind}`, DigestReportSchema, {
        signal,
      }),
    refetchInterval: 5 * REFRESH_MS,
  });
}

/** "Mark all seen": the web cursor becomes exactly the given signal ids. */
export function useMarkSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (seenSignalIds: readonly string[]): Promise<CursorResponse> =>
      request("/api/v1/ops/cursor", CursorResponseSchema, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consumer: "web", seenSignalIds }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: opsKeys.snapshot() }),
  });
}
