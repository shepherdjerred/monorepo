import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";

/** Drill-down hosts and link shapes the collectors attach to signals. */

type LinkInput = NonNullable<SignalInput["links"]>[number];

export const MONOREPO_URL = "https://github.com/shepherdjerred/monorepo";
const GRAFANA_URL = "https://grafana.tailnet-1a49.ts.net";
export const ARGOCD_URL = "https://argocd.tailnet-1a49.ts.net";
export const ALERTMANAGER_URL = "https://alertmanager.tailnet-1a49.ts.net";
export const BUGSINK_URL = "https://bugsink.sjer.red";
export const TRACKER_URL = "https://tracker.tailnet-1a49.ts.net";
export const TEMPORAL_UI_URL = "https://temporal-ui.tailnet-1a49.ts.net";

export const services = new ServiceIndex(SERVICE_CATALOG);

export function serviceForNamespace(namespace: string | undefined): {
  service?: string;
} {
  const service =
    namespace === undefined ? undefined : services.byNamespace(namespace);
  return service === undefined ? {} : { service: service.id };
}

export function exploreLink(
  kind: "logs" | "metrics" | "traces",
  label: string,
  expr: string,
): LinkInput {
  const datasource = { logs: "loki", metrics: "prometheus", traces: "tempo" }[
    kind
  ];
  const panes = {
    ops: {
      datasource,
      queries: [{ refId: "A", datasource: { uid: datasource }, expr }],
      range: { from: "now-1h", to: "now" },
    },
  };
  return {
    kind,
    label,
    url: `${GRAFANA_URL}/explore?schemaVersion=1&orgId=1&panes=${encodeURIComponent(JSON.stringify(panes))}`,
  };
}

export function logsLink(namespace: string): LinkInput {
  return exploreLink(
    "logs",
    `Logs: ${namespace}`,
    `{namespace="${namespace}"}`,
  );
}

export function metricsLink(label: string, expr: string): LinkInput {
  return exploreLink("metrics", label, expr);
}

export function pullRequestLink(number: number): LinkInput {
  return {
    kind: "github",
    label: `PR #${String(number)}`,
    url: `${MONOREPO_URL}/pull/${String(number)}`,
  };
}
