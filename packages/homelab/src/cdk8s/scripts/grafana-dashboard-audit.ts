#!/usr/bin/env bun

import { z } from "zod";

const SearchResultSchema = z.object({
  uid: z.string(),
  title: z.string(),
  type: z.string(),
});

const TargetSchema = z
  .object({
    expr: z.string().optional(),
    refId: z.string().optional(),
  })
  .loose();

const PanelSchema = z
  .object({
    title: z.string().optional(),
    type: z.string().optional(),
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

function replaceGrafanaVariables(expr: string): string {
  return expr
    .replaceAll(/\$\{?environment\}?/g, ".*")
    .replaceAll(/\$\{?server\}?/g, ".*")
    .replaceAll(/\$\{?instance\}?/g, ".*")
    .replaceAll(/\$\{?repo\}?/g, ".*")
    .replaceAll(/\$\{?schedule\}?/g, ".*")
    .replaceAll(/\$\{?namespace\}?/g, ".*")
    .replaceAll(/\$\{?device\}?/g, ".*")
    .replaceAll(/\$\{?app\}?/g, ".*")
    .replaceAll(/\$\{?provider\}?/g, ".*")
    .replaceAll(/\$\{?kind\}?/g, ".*")
    .replaceAll(/\$\{?source\}?/g, ".*")
    .replaceAll(/\$\{?system_source\}?/g, ".*")
    .replaceAll(/\$\{?status\}?/g, ".*")
    .replaceAll(/\$\{?NAMESPACE\}?/g, "seaweedfs")
    .replaceAll("$__rate_interval", "5m")
    .replaceAll("$__interval", "5m");
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

      const queryResult = await queryPrometheus(target.expr);
      queryResults.push({
        panel: panel.title ?? "(untitled)",
        refId: target.refId ?? "",
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
