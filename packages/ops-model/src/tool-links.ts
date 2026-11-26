import type { Link } from "./snapshot.ts";

/**
 * Browser-facing tool hosts. These are tailnet or public product URLs, not
 * deployment settings: in-cluster service addresses are unreachable from a
 * browser, so deep links always use these hosts.
 */
export const TOOL_HOSTS = {
  woodpecker: "https://woodpecker.sjer.red",
  github: "https://github.com/shepherdjerred/monorepo",
  argocd: "https://argocd.tailnet-1a49.ts.net",
  grafana: "https://grafana.tailnet-1a49.ts.net",
  temporal: "https://temporal-ui.tailnet-1a49.ts.net",
  bugsink: "https://bugsink.sjer.red",
  phoenix: "https://phoenix.tailnet-1a49.ts.net",
  posthog: "https://us.posthog.com",
  prometheus: "https://prometheus.tailnet-1a49.ts.net",
  alertmanager: "https://alertmanager.tailnet-1a49.ts.net",
  homeassistant: "https://homeassistant.tailnet-1a49.ts.net",
} as const;

/**
 * Browser-facing hosts of the first-party apps, for the same reason as
 * `TOOL_HOSTS`. Hub (the `alert-dashboard` workload) answers on `hub` only.
 */
export const APP_HOSTS = {
  hub: "https://hub.tailnet-1a49.ts.net",
  tracker: "https://tracker.tailnet-1a49.ts.net",
  delivery: "https://delivery.tailnet-1a49.ts.net",
  errors: "https://errors.tailnet-1a49.ts.net",
  flags: "https://flags.tailnet-1a49.ts.net",
  golink: "https://go.tailnet-1a49.ts.net",
  feeds: "https://feeds.tailnet-1a49.ts.net",
  media: "https://media.tailnet-1a49.ts.net",
  tasknotes: "https://tasknotes.tailnet-1a49.ts.net",
  mail: "https://mail.tailnet-1a49.ts.net",
  charts: "https://charts.tailnet-1a49.ts.net",
  ciCache: "https://ci-cache.tailnet-1a49.ts.net",
} as const;

const POSTHOG_PROJECT_ID = 549_883;

export type ConsoleLinkGroup = "Apps" | "Tools";

/**
 * One entry in the app switcher shared by Hub, Go link and Flags, and in
 * Hub's launcher and command palette. `id` is stable so each console can
 * mark itself as current and attach its own icon.
 */
export type ConsoleLink = {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly group: ConsoleLinkGroup;
};

/**
 * Every first-party app and outside tool the consoles link to, in display
 * order. Go link lists every other tailnet service, so it is the catch-all
 * for anything not named here.
 */
export const CONSOLE_LINKS: readonly ConsoleLink[] = [
  { id: "hub", label: "Hub", url: APP_HOSTS.hub, group: "Apps" },
  { id: "delivery", label: "Delivery", url: APP_HOSTS.delivery, group: "Apps" },
  { id: "errors", label: "Errors", url: APP_HOSTS.errors, group: "Apps" },
  { id: "flags", label: "Flags", url: APP_HOSTS.flags, group: "Apps" },
  { id: "golink", label: "Go links", url: APP_HOSTS.golink, group: "Apps" },
  { id: "feeds", label: "Feeds", url: APP_HOSTS.feeds, group: "Apps" },
  { id: "tracker", label: "Tracker", url: APP_HOSTS.tracker, group: "Apps" },
  { id: "media", label: "Media", url: APP_HOSTS.media, group: "Apps" },
  {
    id: "tasknotes",
    label: "TaskNotes",
    url: APP_HOSTS.tasknotes,
    group: "Apps",
  },
  { id: "mail", label: "Mail", url: APP_HOSTS.mail, group: "Apps" },
  { id: "charts", label: "Charts", url: APP_HOSTS.charts, group: "Apps" },
  { id: "ci-cache", label: "CI cache", url: APP_HOSTS.ciCache, group: "Apps" },
  { id: "grafana", label: "Grafana", url: TOOL_HOSTS.grafana, group: "Tools" },
  { id: "argocd", label: "Argo CD", url: TOOL_HOSTS.argocd, group: "Tools" },
  {
    id: "temporal",
    label: "Temporal",
    url: TOOL_HOSTS.temporal,
    group: "Tools",
  },
  {
    id: "woodpecker",
    label: "Woodpecker",
    url: TOOL_HOSTS.woodpecker,
    group: "Tools",
  },
  { id: "github", label: "GitHub", url: TOOL_HOSTS.github, group: "Tools" },
  { id: "bugsink", label: "Bugsink", url: TOOL_HOSTS.bugsink, group: "Tools" },
  { id: "phoenix", label: "Phoenix", url: TOOL_HOSTS.phoenix, group: "Tools" },
  {
    id: "posthog",
    label: "PostHog",
    url: `${TOOL_HOSTS.posthog}/project/${String(POSTHOG_PROJECT_ID)}`,
    group: "Tools",
  },
  {
    id: "prometheus",
    label: "Prometheus",
    url: TOOL_HOSTS.prometheus,
    group: "Tools",
  },
  {
    id: "alertmanager",
    label: "Alertmanager",
    url: TOOL_HOSTS.alertmanager,
    group: "Tools",
  },
  {
    id: "homeassistant",
    label: "Home Assistant",
    url: TOOL_HOSTS.homeassistant,
    group: "Tools",
  },
];

const WOODPECKER_REPOSITORY_ID = 1;
const TEMPORAL_NAMESPACE = "prod";

function url(host: string, path: string) {
  return new URL(path, `${host}/`).toString();
}

export function woodpeckerPipelineLink(pipelineNumber: number): Link {
  return {
    kind: "woodpecker",
    label: `Woodpecker #${String(pipelineNumber)}`,
    url: url(
      TOOL_HOSTS.woodpecker,
      `repos/${String(WOODPECKER_REPOSITORY_ID)}/pipeline/${String(pipelineNumber)}`,
    ),
  };
}

export function woodpeckerStepLink(
  pipelineNumber: number,
  step: { pid: number; name: string },
): Link {
  return {
    kind: "woodpecker",
    label: `Woodpecker step ${step.name}`,
    url: url(
      TOOL_HOSTS.woodpecker,
      `repos/${String(WOODPECKER_REPOSITORY_ID)}/pipeline/${String(pipelineNumber)}/${String(step.pid)}`,
    ),
  };
}

export function githubCommitLink(sha: string): Link {
  return {
    kind: "github",
    label: `GitHub commit ${sha.slice(0, 7)}`,
    url: `${TOOL_HOSTS.github}/commit/${encodeURIComponent(sha)}`,
  };
}

export function githubPullRequestLink(number: number): Link {
  return {
    kind: "github",
    label: `GitHub PR #${String(number)}`,
    url: `${TOOL_HOSTS.github}/pull/${String(number)}`,
  };
}

export function argocdApplicationLink(application: string): Link {
  return {
    kind: "argocd",
    label: `Argo CD ${application}`,
    url: url(
      TOOL_HOSTS.argocd,
      `applications/argocd/${encodeURIComponent(application)}`,
    ),
  };
}

export function grafanaDashboardLink(uid: string): Link {
  return {
    kind: "grafana",
    label: `Grafana ${uid}`,
    url: url(TOOL_HOSTS.grafana, `d/${encodeURIComponent(uid)}`),
  };
}

export function temporalWorkflowLink(workflowId: string): Link {
  return {
    kind: "temporal",
    label: "Temporal workflow",
    url: url(
      TOOL_HOSTS.temporal,
      `namespaces/${TEMPORAL_NAMESPACE}/workflows/${encodeURIComponent(workflowId)}`,
    ),
  };
}

export function bugsinkLink(): Link {
  return {
    kind: "bugsink",
    label: "Bugsink",
    url: url(TOOL_HOSTS.bugsink, ""),
  };
}

export function hubReportsUrl(): string {
  return url(APP_HOSTS.hub, "reports");
}

export function hubReportRunUrl(reportRunId: string): string {
  return url(APP_HOSTS.hub, `reports/runs/${encodeURIComponent(reportRunId)}`);
}

export function hubDigestRunUrl(
  kind: "daily" | "weekly",
  periodKey: string,
): string {
  return url(
    APP_HOSTS.hub,
    `reports/digests/${encodeURIComponent(kind)}/${encodeURIComponent(periodKey)}`,
  );
}

export function hubIncidentMailUrl(outboxId: string): string {
  return url(APP_HOSTS.hub, `reports/mail/${encodeURIComponent(outboxId)}`);
}

export function hubReportsLink(): Link {
  return {
    kind: "hub",
    label: "Hub Reports",
    url: hubReportsUrl(),
  };
}

export function hubReportRunLink(reportRunId: string): Link {
  return {
    kind: "hub",
    label: "Hub report",
    url: hubReportRunUrl(reportRunId),
  };
}

export function hubDigestRunLink(
  kind: "daily" | "weekly",
  periodKey: string,
): Link {
  return {
    kind: "hub",
    label: `Hub ${kind} digest ${periodKey}`,
    url: hubDigestRunUrl(kind, periodKey),
  };
}

export function hubIncidentMailLink(outboxId: string): Link {
  return {
    kind: "hub",
    label: "Hub incident mail",
    url: hubIncidentMailUrl(outboxId),
  };
}

export function hubTracesUrl(): string {
  return url(APP_HOSTS.hub, "traces");
}

export function hubTraceDetailUrl(traceId: string): string {
  return url(APP_HOSTS.hub, `traces/${encodeURIComponent(traceId)}`);
}

export function hubTracesLink(): Link {
  return {
    kind: "hub",
    label: "Hub Traces",
    url: hubTracesUrl(),
  };
}

export function hubTraceDetailLink(traceId: string): Link {
  return {
    kind: "hub",
    label: `Hub trace ${traceId.slice(0, 8)}`,
    url: hubTraceDetailUrl(traceId),
  };
}

function buildGrafanaExploreUrl(grafanaUrl: string, panes: unknown): string {
  const explore = new URL("explore", `${grafanaUrl.replace(/\/+$/u, "")}/`);
  explore.searchParams.set("schemaVersion", "1");
  explore.searchParams.set("orgId", "1");
  explore.searchParams.set("panes", JSON.stringify(panes));
  return explore.toString();
}

/**
 * Grafana Explore Loki log query targeting correlated logs (`llm.provider.response`
 * and structured span logs) for a given `traceId`.
 */
export function grafanaLokiTraceExploreUrl(input: {
  grafanaUrl: string;
  traceId: string;
  fromMs?: number;
  toMs?: number;
}): string {
  const datasource = { type: "loki", uid: "loki" };
  const range =
    input.fromMs === undefined || input.toMs === undefined
      ? { from: "now-24h", to: "now" }
      : {
          from: String(Math.max(0, input.fromMs - 5 * 60_000)),
          to: String(input.toMs + 5 * 60_000),
        };
  return buildGrafanaExploreUrl(input.grafanaUrl, {
    a: {
      datasource: datasource.uid,
      queries: [
        {
          refId: "A",
          datasource,
          editorMode: "code",
          queryType: "range",
          expr: `{namespace=~".+"} |= ${JSON.stringify(input.traceId)}`,
        },
      ],
      range,
    },
  });
}

/** First-party chart-version metadata for a published Helm chart. */
export function chartmuseumChartLink(name: string, version: string): Link {
  return {
    kind: "registry",
    label: `Chart ${name} ${version}`,
    url: url(
      APP_HOSTS.charts,
      `api/charts/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    ),
  };
}

/**
 * Grafana Explore flamegraph link targeting the in-cluster Pyroscope continuous
 * profiling datasource (`uid: "pyroscope"`, `type: "grafana-pyroscope-datasource"`),
 * scoped to `{namespace="<namespace>"}`.
 */
export function grafanaPyroscopeExploreUrl(input: {
  grafanaUrl: string;
  namespace: string;
  service?: string;
}): string {
  const datasource = {
    type: "grafana-pyroscope-datasource",
    uid: "pyroscope",
  };
  const panes = {
    a: {
      datasource: datasource.uid,
      queries: [
        {
          refId: "A",
          datasource,
          queryType: "both",
          profileTypeId: "process_cpu:cpu:nanoseconds:cpu:nanoseconds",
          labelSelector: `{namespace=${JSON.stringify(input.namespace)}}`,
        },
      ],
      range: { from: "now-1h", to: "now" },
    },
  };
  return buildGrafanaExploreUrl(input.grafanaUrl, panes);
}
