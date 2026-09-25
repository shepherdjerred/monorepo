import type { Service } from "@shepherdjerred/ops-model/catalog.ts";
import type { Link } from "@shepherdjerred/ops-model/snapshot.ts";

/**
 * Browser-facing hosts. These are tailnet product URLs, not deployment
 * settings: the in-cluster `GRAFANA_URL` the server calls is not reachable
 * from a browser, so deep links always use the public tailnet host.
 */
export const GRAFANA_PUBLIC_URL = "https://grafana.tailnet-1a49.ts.net";
export const ARGOCD_PUBLIC_URL = "https://argocd.tailnet-1a49.ts.net";

export type GrafanaDatasourceUids = {
  prometheus: string;
  loki: string;
  tempo: string;
};

const DEFAULT_RANGE = { from: "now-6h", to: "now" } as const;

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function alternation(values: readonly string[]): string {
  return values.map((value) => escapeRegex(value)).join("|");
}

function exploreUrl(
  datasource: { type: string; uid: string },
  query: Record<string, string>,
): string {
  const panes = {
    a: {
      datasource: datasource.uid,
      queries: [{ refId: "A", datasource, ...query }],
      range: DEFAULT_RANGE,
    },
  };
  const url = new URL("/explore", GRAFANA_PUBLIC_URL);
  url.searchParams.set("schemaVersion", "1");
  url.searchParams.set("orgId", "1");
  url.searchParams.set("panes", JSON.stringify(panes));
  return url.toString();
}

/** LogQL selector for every namespace the service owns. */
export function serviceLogQuery(service: Service): string {
  return `{namespace=~"${alternation(service.namespaces)}"}`;
}

/**
 * TraceQL over `service.name`. Workloads set `OTEL_SERVICE_NAME` to their
 * namespace or catalog id, and no k8s attributes processor adds a namespace
 * resource attribute, so the id and namespaces are the join keys.
 */
export function serviceTraceQuery(service: Service): string {
  const names = [...new Set([service.id, ...service.namespaces])];
  return `{ resource.service.name =~ "${alternation(names)}" }`;
}

export function serviceMetricsQuery(service: Service): string {
  return `sum by (pod) (rate(container_cpu_usage_seconds_total{namespace=~"${alternation(service.namespaces)}", container!=""}[5m]))`;
}

/** Drill-down links for one catalog service. */
export function serviceLinks(
  service: Service,
  uids: GrafanaDatasourceUids,
): Link[] {
  const links: Link[] = [];
  if (service.namespaces.length > 0) {
    links.push(
      {
        kind: "logs",
        label: "Logs",
        url: exploreUrl(
          { type: "loki", uid: uids.loki },
          { expr: serviceLogQuery(service) },
        ),
      },
      {
        kind: "traces",
        label: "Traces",
        url: exploreUrl(
          { type: "tempo", uid: uids.tempo },
          { queryType: "traceql", query: serviceTraceQuery(service) },
        ),
      },
      {
        kind: "metrics",
        label: "CPU by pod",
        url: exploreUrl(
          { type: "prometheus", uid: uids.prometheus },
          { expr: serviceMetricsQuery(service) },
        ),
      },
    );
  }
  for (const dashboard of service.grafanaDashboards) {
    links.push({
      kind: "grafana",
      label: `Dashboard ${dashboard}`,
      url: new URL(
        `/d/${encodeURIComponent(dashboard)}`,
        GRAFANA_PUBLIC_URL,
      ).toString(),
    });
  }
  for (const app of service.argoApps) {
    links.push({
      kind: "argocd",
      label: `Argo CD ${app}`,
      url: new URL(
        `/applications/argocd/${encodeURIComponent(app)}`,
        ARGOCD_PUBLIC_URL,
      ).toString(),
    });
  }
  return links;
}
