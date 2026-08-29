#!/usr/bin/env bun

import { z } from "zod";
import { replaceGrafanaVariables } from "./grafana-variable-substitution.ts";

const SearchResultSchema = z.object({
  uid: z.string(),
  title: z.string(),
  type: z.string(),
});

const DatasourceRefSchema = z.union([
  z.string(),
  z.object({ type: z.string().optional(), uid: z.string().optional() }).loose(),
]);

const TargetSchema = z
  .object({
    expr: z.string().optional(),
    refId: z.string().optional(),
    datasource: DatasourceRefSchema.optional(),
  })
  .loose();

const PanelSchema = z
  .object({
    title: z.string().optional(),
    type: z.string().optional(),
    datasource: DatasourceRefSchema.optional(),
    targets: z.array(TargetSchema).optional(),
    panels: z.array(z.unknown()).optional(),
    gridPos: z
      .object({
        x: z.number().optional(),
        y: z.number().optional(),
        w: z.number().optional(),
        h: z.number().optional(),
      })
      .optional(),
  })
  .loose();

const DashboardResponseSchema = z.object({
  dashboard: z
    .object({
      uid: z.string(),
      title: z.string(),
      style: z.string().optional(),
      panels: z.array(z.unknown()).optional(),
    })
    .loose(),
  meta: z
    .object({
      url: z.string().optional(),
      provisioned: z.boolean().optional(),
    })
    .loose()
    .optional(),
});

const PrometheusQuerySchema = z.object({
  status: z.string(),
  errorType: z.string().optional(),
  error: z.string().optional(),
  data: z
    .object({
      result: z.array(z.unknown()).optional(),
    })
    .optional(),
});

function getRequiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

const grafanaUrl = getRequiredEnv("GRAFANA_URL");
const grafanaApiKey = getRequiredEnv("GRAFANA_API_KEY");

const headers = {
  Authorization: `Bearer ${grafanaApiKey}`,
  Accept: "application/json",
};

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `GET ${url} failed with ${String(response.status)}: ${text.slice(0, 300)}`,
    );
  }

  return JSON.parse(text);
}

function collectPanels(
  rawPanels: unknown[] | undefined,
): z.infer<typeof PanelSchema>[] {
  if (rawPanels === undefined) {
    return [];
  }

  return rawPanels.flatMap((rawPanel) => {
    const panel = PanelSchema.parse(rawPanel);
    return [panel, ...collectPanels(panel.panels)];
  });
}

async function queryPrometheus(expr: string): Promise<{
  resultCount: number;
  error?: string;
}> {
  const url = new URL(
    `${grafanaUrl}/api/datasources/proxy/uid/prometheus/api/v1/query`,
  );
  url.searchParams.set("query", replaceGrafanaVariables(expr));
  const body = PrometheusQuerySchema.parse(await getJson(url.toString()));

  if (body.status !== "success") {
    return {
      resultCount: 0,
      error: `${body.errorType ?? "query_error"}: ${body.error ?? "unknown"}`,
    };
  }

  return { resultCount: body.data?.result?.length ?? 0 };
}

const LokiQuerySchema = z.object({
  status: z.string(),
  data: z
    .object({
      result: z.array(z.unknown()).optional(),
    })
    .optional(),
});

async function queryLoki(expr: string): Promise<{
  resultCount: number;
  error?: string;
}> {
  const url = new URL(
    `${grafanaUrl}/api/datasources/proxy/uid/loki/loki/api/v1/query_range`,
  );
  url.searchParams.set("query", replaceGrafanaVariables(expr));
  const nowNs = Date.now() * 1_000_000;
  url.searchParams.set("start", String(nowNs - 6 * 3600 * 1_000_000_000));
  url.searchParams.set("end", String(nowNs));
  url.searchParams.set("limit", "10");
  const body = LokiQuerySchema.parse(await getJson(url.toString()));

  if (body.status !== "success") {
    return { resultCount: 0, error: "loki_query_error" };
  }

  return { resultCount: body.data?.result?.length ?? 0 };
}

type DatasourceRef = z.infer<typeof DatasourceRefSchema>;

function datasourceType(ref: DatasourceRef | undefined): string | undefined {
  if (ref === undefined) return undefined;
  if (typeof ref === "string") return ref;
  return ref.type ?? ref.uid;
}

const searchUrl = new URL(`${grafanaUrl}/api/search`);
searchUrl.searchParams.set("type", "dash-db");

const searchResults = z
  .array(SearchResultSchema)
  .parse(await getJson(searchUrl.toString()))
  .filter((result) => result.type === "dash-db");

const auditResults = [];

for (const searchResult of searchResults) {
  const dashboardResponse = DashboardResponseSchema.parse(
    await getJson(
      `${grafanaUrl}/api/dashboards/uid/${encodeURIComponent(searchResult.uid)}`,
    ),
  );
  const panels = collectPanels(dashboardResponse.dashboard.panels);
  const queryResults = [];

  for (const panel of panels) {
    for (const target of panel.targets ?? []) {
      if (target.expr === undefined || target.expr.trim() === "") {
        continue;
      }

      // A target's datasource wins over its panel's; string refs and
      // {type, uid} objects both occur in provisioned dashboards.
      const dsType =
        datasourceType(target.datasource) ??
        datasourceType(panel.datasource) ??
        "prometheus";
      // Grafana expression targets compute from other refIds and cannot be
      // executed against a datasource proxy.
      if (dsType === "__expr__" || dsType === "datasource") {
        continue;
      }

      const queryResult =
        dsType === "loki"
          ? await queryLoki(target.expr)
          : await queryPrometheus(target.expr);
      queryResults.push({
        panel: panel.title ?? "(untitled)",
        refId: target.refId ?? "",
        datasource: dsType,
        expr: target.expr,
        ...queryResult,
      });
    }
  }

  auditResults.push({
    uid: dashboardResponse.dashboard.uid,
    title: dashboardResponse.dashboard.title,
    style: dashboardResponse.dashboard.style ?? "light",
    provisioned: dashboardResponse.meta?.provisioned ?? false,
    url: dashboardResponse.meta?.url ?? "",
    panelCount: panels.length,
    queryCount: queryResults.length,
    queryErrors: queryResults.filter((result) => result.error !== undefined),
    emptyQueries: queryResults.filter(
      (result) => result.error === undefined && result.resultCount === 0,
    ),
  });
}

const summary = {
  dashboards: auditResults.length,
  panels: auditResults.reduce((sum, result) => sum + result.panelCount, 0),
  queries: auditResults.reduce((sum, result) => sum + result.queryCount, 0),
  queryErrors: auditResults.flatMap((result) => result.queryErrors).length,
  emptyQueries: auditResults.flatMap((result) => result.emptyQueries).length,
  darkDashboards: auditResults.filter((result) => result.style === "dark"),
};

console.log(JSON.stringify({ summary, dashboards: auditResults }, null, 2));

if (summary.queryErrors > 0) {
  process.exitCode = 1;
}
