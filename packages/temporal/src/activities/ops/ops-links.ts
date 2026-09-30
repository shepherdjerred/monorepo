import type { Link } from "@shepherdjerred/ops-model/snapshot.ts";

/** Tailnet hosts of the drill-down tools (see the homelab TailscaleIngress hosts). */
export const GRAFANA_URL = "https://grafana.tailnet-1a49.ts.net";
export const ARGOCD_URL = "https://argocd.tailnet-1a49.ts.net";
export const ALERTMANAGER_URL = "https://alertmanager.tailnet-1a49.ts.net";
export const BUGSINK_URL = "https://bugsink.sjer.red";
export const POSTHOG_PROJECT_URL = "https://us.posthog.com/project/549883";
export const MONOREPO_URL = "https://github.com/shepherdjerred/monorepo";

type ExploreDatasource = "prometheus" | "loki" | "tempo";

/** A Grafana Explore deep link for one query over a relative range. */
export function grafanaExploreUrl(input: {
  datasource: ExploreDatasource;
  expr: string;
  from?: string;
}): string {
  const panes = {
    ops: {
      datasource: input.datasource,
      queries: [
        { refId: "A", datasource: { uid: input.datasource }, expr: input.expr },
      ],
      range: { from: input.from ?? "now-1h", to: "now" },
    },
  };
  return `${GRAFANA_URL}/explore?schemaVersion=1&orgId=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
}

/** A Grafana Explore deep link for one TraceQL search. */
function tempoExploreUrl(traceql: string, from = "now-1h"): string {
  const panes = {
    ops: {
      datasource: "tempo",
      queries: [
        {
          refId: "A",
          datasource: { type: "tempo", uid: "tempo" },
          queryType: "traceql",
          query: traceql,
        },
      ],
      range: { from, to: "now" },
    },
  };
  return `${GRAFANA_URL}/explore?schemaVersion=1&orgId=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
}

/**
 * Traces of one root service in Grafana Explore, narrowed by an extra TraceQL
 * condition such as `status = error` or `duration > 5s`.
 */
export function tracesLink(
  serviceName: string,
  condition: string,
  label: string,
): Link {
  return {
    kind: "traces",
    label,
    url: tempoExploreUrl(
      `{ resource.service.name = ${JSON.stringify(serviceName)} && ${condition} }`,
    ),
  };
}

/** Recent logs of one namespace (optionally one pod) in Grafana Explore. */
export function logsLink(namespace: string, pod?: string): Link {
  const selector =
    pod === undefined
      ? `{namespace="${namespace}"}`
      : `{namespace="${namespace}", pod="${pod}"}`;
  return {
    kind: "logs",
    label: pod === undefined ? `Logs: ${namespace}` : `Logs: ${pod}`,
    url: grafanaExploreUrl({ datasource: "loki", expr: selector }),
  };
}

/** Error-level log lines of one namespace. */
export function errorLogsLink(namespace: string): Link {
  return {
    kind: "logs",
    label: `Error logs: ${namespace}`,
    url: grafanaExploreUrl({
      datasource: "loki",
      expr: `{namespace="${namespace}"} |~ "(?i)(error|fatal|panic|exception)"`,
    }),
  };
}

export function metricsLink(label: string, expr: string, from?: string): Link {
  return {
    kind: "metrics",
    label,
    url: grafanaExploreUrl({
      datasource: "prometheus",
      expr,
      ...(from === undefined ? {} : { from }),
    }),
  };
}

export function argoAppLink(app: string): Link {
  return {
    kind: "argocd",
    label: `Argo CD: ${app}`,
    url: `${ARGOCD_URL}/applications/argocd/${encodeURIComponent(app)}`,
  };
}

export function alertmanagerLink(alertname: string): Link {
  const filter = encodeURIComponent(`{alertname="${alertname}"}`);
  return {
    kind: "native",
    label: "Alertmanager",
    url: `${ALERTMANAGER_URL}/#/alerts?filter=${filter}`,
  };
}

/** Accept an upstream-provided URL only when it is absolute http(s). */
export function externalLink(
  kind: Link["kind"],
  label: string,
  url: string | undefined,
): Link[] {
  return url !== undefined && /^https?:\/\//u.test(url)
    ? [{ kind, label, url }]
    : [];
}
