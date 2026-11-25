import type { DigestKind } from "@shepherdjerred/ops-model/digest.ts";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import {
  DigestRunDetailSchema,
  IncidentMailDetailSchema,
  ReportRunDetailSchema,
  ReportsFeedResponseSchema,
  ReportsOverviewResponseSchema,
  type ReportsFeedQueryInput,
} from "#shared/reports-schema";

const ApiErrorBodySchema = z.object({
  error: z.string(),
});

export class ReportsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ReportsApiError";
  }
}

export function isReportsNotFound(error: unknown): boolean {
  return error instanceof ReportsApiError && error.status === 404;
}

export async function fetchReportsJson<T extends z.ZodType>(
  path: string,
  schema: T,
  signal?: AbortSignal,
): Promise<z.infer<T>> {
  const response = await globalThis.fetch(path, {
    headers: { accept: "application/json" },
    ...(signal === undefined ? {} : { signal }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiErrorBodySchema.safeParse(body);
    throw new ReportsApiError(
      response.status,
      parsed.success
        ? parsed.data.error
        : `Request failed with HTTP ${String(response.status)}`,
    );
  }
  return schema.parse(body);
}

const REFRESH_MS = 60_000;

export function buildFeedSearchString(query: ReportsFeedQueryInput): string {
  const params = new URLSearchParams();
  if (query.tab !== undefined && query.tab !== "all") {
    params.set("tab", query.tab);
  }
  if (query.scheduleId !== undefined && query.scheduleId.length > 0) {
    params.set("scheduleId", query.scheduleId);
  }
  if (query.mailbox !== undefined && query.mailbox.length > 0) {
    params.set("mailbox", query.mailbox);
  }
  if (query.verdict !== undefined) {
    params.set("verdict", query.verdict);
  }
  if (query.delivery !== undefined) {
    params.set("delivery", query.delivery);
  }
  if (query.hasPr === "1") {
    params.set("hasPr", "1");
  }
  if (query.q !== undefined && query.q.trim().length > 0) {
    params.set("q", query.q.trim());
  }
  if (typeof query.limit === "number") {
    params.set("limit", String(query.limit));
  }
  const serialized = params.toString();
  return serialized.length === 0 ? "" : `?${serialized}`;
}

export const reportsKeys = {
  all: ["reports"] as const,
  overview: () => [...reportsKeys.all, "overview"] as const,
  feeds: () => [...reportsKeys.all, "feed"] as const,
  feed: (query: ReportsFeedQueryInput) =>
    [...reportsKeys.feeds(), buildFeedSearchString(query)] as const,
  run: (id: string) => [...reportsKeys.all, "run", id] as const,
  digest: (kind: DigestKind, periodKey: string) =>
    [...reportsKeys.all, "digest", kind, periodKey] as const,
  incident: (id: string) => [...reportsKeys.all, "incident", id] as const,
};

export function reportsOverviewQuery() {
  return queryOptions({
    queryKey: reportsKeys.overview(),
    queryFn: ({ signal }) =>
      fetchReportsJson(
        "/api/v1/reports/overview",
        ReportsOverviewResponseSchema,
        signal,
      ),
    refetchInterval: REFRESH_MS,
  });
}

export function reportsFeedQuery(query: ReportsFeedQueryInput) {
  const suffix = buildFeedSearchString(query);
  return queryOptions({
    queryKey: reportsKeys.feed(query),
    queryFn: ({ signal }) =>
      fetchReportsJson(
        `/api/v1/reports/feed${suffix}`,
        ReportsFeedResponseSchema,
        signal,
      ),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
}

export function reportRunDetailQuery(id: string) {
  return queryOptions({
    queryKey: reportsKeys.run(id),
    queryFn: ({ signal }) =>
      fetchReportsJson(
        `/api/v1/reports/runs/${encodeURIComponent(id)}`,
        ReportRunDetailSchema,
        signal,
      ),
    refetchInterval: REFRESH_MS,
  });
}

export function digestRunDetailQuery(kind: DigestKind, periodKey: string) {
  return queryOptions({
    queryKey: reportsKeys.digest(kind, periodKey),
    queryFn: ({ signal }) =>
      fetchReportsJson(
        `/api/v1/reports/digests/${encodeURIComponent(kind)}/${encodeURIComponent(periodKey)}`,
        DigestRunDetailSchema,
        signal,
      ),
    refetchInterval: REFRESH_MS,
  });
}

export function incidentMailDetailQuery(id: string) {
  return queryOptions({
    queryKey: reportsKeys.incident(id),
    queryFn: ({ signal }) =>
      fetchReportsJson(
        `/api/v1/reports/incidents/${encodeURIComponent(id)}`,
        IncidentMailDetailSchema,
        signal,
      ),
    refetchInterval: REFRESH_MS,
  });
}
