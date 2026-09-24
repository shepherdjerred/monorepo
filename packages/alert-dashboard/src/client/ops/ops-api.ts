import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";

import {
  ChangeListResponseSchema,
  CursorResponseSchema,
  DigestReportSchema,
  OpsErrorSchema,
  SeriesResponseSchema,
  ServiceDetailSchema,
  SnapshotResponseSchema,
  type CursorResponse,
  type DigestKind,
  type OpsError,
  type SeriesPresetId,
  type SeriesRange,
} from "#shared/ops-schema";

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
};

export function snapshotQuery() {
  return queryOptions({
    queryKey: opsKeys.snapshot(),
    queryFn: () =>
      request("/api/v1/ops/snapshot?consumer=web", SnapshotResponseSchema),
    refetchInterval: REFRESH_MS,
  });
}

export function changesQuery(input: { service?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (input.service !== undefined) params.set("service", input.service);
  params.set("limit", String(input.limit ?? 50));
  return queryOptions({
    queryKey: [...opsKeys.all, "changes", input] as const,
    queryFn: () =>
      request(
        `/api/v1/ops/changes?${params.toString()}`,
        ChangeListResponseSchema,
      ),
    refetchInterval: REFRESH_MS,
  });
}

export function serviceQuery(id: string) {
  return queryOptions({
    queryKey: [...opsKeys.all, "service", id] as const,
    queryFn: () =>
      request(
        `/api/v1/ops/services/${encodeURIComponent(id)}`,
        ServiceDetailSchema,
      ),
    refetchInterval: REFRESH_MS,
  });
}

export function seriesQuery(preset: SeriesPresetId, range: SeriesRange) {
  return queryOptions({
    queryKey: [...opsKeys.all, "series", preset, range] as const,
    queryFn: () =>
      request(
        `/api/v1/ops/series?preset=${preset}&range=${range}`,
        SeriesResponseSchema,
      ),
    staleTime: REFRESH_MS,
    refetchInterval: 5 * REFRESH_MS,
  });
}

export function reviewQuery(kind: DigestKind) {
  return queryOptions({
    queryKey: [...opsKeys.all, "review", kind] as const,
    queryFn: () =>
      request(`/api/v1/ops/review?kind=${kind}`, DigestReportSchema),
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
