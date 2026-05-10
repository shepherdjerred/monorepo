import { grafanaPost, grafanaRequest } from "./client.ts";
import {
  PromQueryResultSchema,
  PrometheusLabelResponseSchema,
} from "./schemas.ts";
import type { PromQueryResult } from "./types.ts";
import { parseTimeRange } from "./time.ts";
import { findDefaultDatasource, resolveUidToId } from "./datasources.ts";

export type QueryPrometheusOptions = {
  datasourceUid?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  instant?: boolean | undefined;
};

export async function queryPrometheus(
  expr: string,
  options: QueryPrometheusOptions = {},
): Promise<PromQueryResult> {
  let dsUid = options.datasourceUid;
  if (dsUid == null) {
    const ds = await findDefaultDatasource("prometheus");
    dsUid = ds.uid;
  }

  const { from, to } = parseTimeRange(options.from, options.to);

  const body = {
    queries: [
      {
        refId: "A",
        datasource: { uid: dsUid },
        expr,
        instant: options.instant === true,
        range: options.instant !== true,
        intervalMs: 15_000,
        maxDataPoints: 1000,
      },
    ],
    from: String(from),
    to: String(to),
  };

  const result = await grafanaPost(
    "/api/ds/query",
    PromQueryResultSchema,
    body,
  );

  if (!result.success || result.data == null) {
    throw new Error(result.error ?? "Failed to query Prometheus");
  }

  return result.data;
}

async function resolveDatasourceId(
  datasourceUid: string | undefined,
): Promise<number> {
  if (datasourceUid != null) {
    return resolveUidToId(datasourceUid);
  }
  const ds = await findDefaultDatasource("prometheus");
  return ds.id;
}

export async function getMetricNames(
  datasourceUid?: string,
  match?: string,
): Promise<string[]> {
  const dsId = await resolveDatasourceId(datasourceUid);

  const params: Record<string, string> = {};
  if (match != null && match.length > 0) {
    params["match[]"] = match;
  }

  const result = await grafanaRequest(
    `/api/datasources/proxy/${String(dsId)}/api/v1/label/__name__/values`,
    PrometheusLabelResponseSchema,
    params,
  );

  if (!result.success || result.data == null) {
    throw new Error(result.error ?? "Failed to fetch metric names");
  }

  return result.data.data;
}

export async function getLabelNames(
  datasourceUid?: string,
  metric?: string,
): Promise<string[]> {
  const dsId = await resolveDatasourceId(datasourceUid);

  const params: Record<string, string> = {};
  if (metric != null && metric.length > 0) {
    params["match[]"] = metric;
  }

  const result = await grafanaRequest(
    `/api/datasources/proxy/${String(dsId)}/api/v1/labels`,
    PrometheusLabelResponseSchema,
    params,
  );

  if (!result.success || result.data == null) {
    throw new Error(result.error ?? "Failed to fetch label names");
  }

  return result.data.data;
}

export async function getLabelValues(
  datasourceUid: string | undefined,
  labelName: string,
  metric?: string,
): Promise<string[]> {
  const dsId = await resolveDatasourceId(datasourceUid);

  const params: Record<string, string> = {};
  if (metric != null && metric.length > 0) {
    params["match[]"] = metric;
  }

  const result = await grafanaRequest(
    `/api/datasources/proxy/${String(dsId)}/api/v1/label/${labelName}/values`,
    PrometheusLabelResponseSchema,
    params,
  );

  if (!result.success || result.data == null) {
    throw new Error(result.error ?? "Failed to fetch label values");
  }

  return result.data.data;
}
