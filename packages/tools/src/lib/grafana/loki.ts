import { grafanaPost, grafanaRequest } from "./client.ts";
import {
  PromQueryResultSchema,
  PrometheusLabelResponseSchema,
} from "./schemas.ts";
import type { PromQueryResult } from "./types.ts";
import { parseTimeRange } from "./time.ts";
import { findDefaultDatasource, resolveUidToId } from "./datasources.ts";

export type QueryLokiOptions = {
  datasourceUid?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
};

async function resolveLokiDatasource(
  datasourceUid: string | undefined,
): Promise<{ uid: string; id: number }> {
  if (datasourceUid != null) {
    const id = await resolveUidToId(datasourceUid);
    return { uid: datasourceUid, id };
  }
  const ds = await findDefaultDatasource("loki");
  return { uid: ds.uid, id: ds.id };
}

export async function queryLoki(
  expr: string,
  options: QueryLokiOptions = {},
): Promise<PromQueryResult> {
  const ds = await resolveLokiDatasource(options.datasourceUid);
  const { from, to } = parseTimeRange(options.from, options.to);

  const body = {
    queries: [
      {
        refId: "A",
        datasource: { uid: ds.uid },
        expr,
        maxLines: options.limit ?? 100,
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
    throw new Error(result.error ?? "Failed to query Loki");
  }

  return result.data;
}

export async function getLokiLabels(datasourceUid?: string): Promise<string[]> {
  const ds = await resolveLokiDatasource(datasourceUid);

  const result = await grafanaRequest(
    `/api/datasources/proxy/${String(ds.id)}/loki/api/v1/labels`,
    PrometheusLabelResponseSchema,
  );

  if (!result.success || result.data == null) {
    throw new Error(result.error ?? "Failed to fetch Loki labels");
  }

  return result.data.data;
}

export async function getLokiLabelValues(
  datasourceUid: string | undefined,
  labelName: string,
): Promise<string[]> {
  const ds = await resolveLokiDatasource(datasourceUid);

  const result = await grafanaRequest(
    `/api/datasources/proxy/${String(ds.id)}/loki/api/v1/label/${labelName}/values`,
    PrometheusLabelResponseSchema,
  );

  if (!result.success || result.data == null) {
    throw new Error(result.error ?? "Failed to fetch Loki label values");
  }

  return result.data.data;
}
