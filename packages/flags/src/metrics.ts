import type { FlagStore } from "./store.ts";

export const PROMETHEUS_CONTENT_TYPE =
  "text/plain; version=0.0.4; charset=utf-8";

export type FlagsSurface = "management" | "evaluation";

export type FlagsRouteLabel =
  | "healthz"
  | "metrics"
  | "snapshot"
  | "evaluate"
  | "deployments"
  | "diff"
  | "deployment"
  | "flag"
  | "apply"
  | "create_missing"
  | "retire"
  | "history"
  | "metadata"
  | "archive"
  | "usage"
  | "assets"
  | "client"
  | "other";

export type FlagsMetrics = {
  readonly recordRequest: (
    surface: FlagsSurface,
    route: FlagsRouteLabel,
    status: number,
  ) => void;
  readonly render: (store: FlagStore) => string;
};

const SNAPSHOT_PATH = /^\/v1\/deployments\/[^/]+\/[^/]+\/snapshot$/u;
const DEPLOYMENT_PATH = /^\/v1\/deployments\/[^/]+\/[^/]+$/u;
const FLAG_PATH = /^\/v1\/deployments\/[^/]+\/[^/]+\/flags\/[^/]+$/u;
const APPLY_PATH = /^\/v1\/deployments\/[^/]+\/[^/]+\/apply$/u;
const CREATE_MISSING_PATH =
  /^\/v1\/deployments\/[^/]+\/[^/]+\/create-missing$/u;
const RETIRE_PATH = /^\/v1\/deployments\/[^/]+\/[^/]+\/retire$/u;
const HISTORY_PATH =
  /^\/v1\/deployments\/[^/]+\/[^/]+\/flags\/[^/]+\/history$/u;
const METADATA_PATH = /^\/v1\/deployments\/[^/]+\/[^/]+\/metadata$/u;

const EXACT_MANAGEMENT_ROUTES: Readonly<Record<string, FlagsRouteLabel>> = {
  "/metrics": "metrics",
  "/v1/deployments": "deployments",
  "/v1/diff": "diff",
  "/v1/archive": "archive",
  "/v1/usage": "usage",
};

const PATTERN_MANAGEMENT_ROUTES: readonly (readonly [
  RegExp,
  FlagsRouteLabel,
])[] = [
  [DEPLOYMENT_PATH, "deployment"],
  [FLAG_PATH, "flag"],
  [APPLY_PATH, "apply"],
  [CREATE_MISSING_PATH, "create_missing"],
  [RETIRE_PATH, "retire"],
  [HISTORY_PATH, "history"],
  [METADATA_PATH, "metadata"],
];

function escapeLabelValue(value: string): string {
  return value
    .replaceAll("\\", String.raw`\\`)
    .replaceAll("\n", String.raw`\n`)
    .replaceAll('"', String.raw`\"`);
}

function classifyManagementRoute(
  method: string,
  path: string,
  hasClient: boolean,
): FlagsRouteLabel {
  const exact = EXACT_MANAGEMENT_ROUTES[path];
  if (exact !== undefined) return exact;
  for (const [pattern, label] of PATTERN_MANAGEMENT_ROUTES) {
    if (pattern.test(path)) return label;
  }
  if (path === "/assets" || path.startsWith("/assets/")) return "assets";
  const isReadMethod = method === "GET" || method === "HEAD";
  const isApiPath = path === "/v1" || path.startsWith("/v1/");
  return hasClient && isReadMethod && !isApiPath ? "client" : "other";
}

export function classifyFlagsRoute(
  surface: FlagsSurface,
  method: string,
  path: string,
  hasClient: boolean,
): FlagsRouteLabel {
  if (path === "/healthz") return "healthz";
  if (path === "/v1/evaluate") return "evaluate";
  if (SNAPSHOT_PATH.test(path)) return "snapshot";
  return surface === "evaluation"
    ? "other"
    : classifyManagementRoute(method, path, hasClient);
}

export function createFlagsMetrics(): FlagsMetrics {
  const requests = new Map<string, number>();

  return {
    recordRequest(surface, route, status) {
      const key = `surface="${surface}",route="${route}",status="${String(status)}"`;
      requests.set(key, (requests.get(key) ?? 0) + 1);
    },
    render(store) {
      const summaries = store.list();
      const definedTotal = summaries.reduce(
        (sum, deployment) => sum + deployment.flagCount,
        0,
      );
      return [
        "# HELP flags_deployments Stored feature-flag deployment documents.",
        "# TYPE flags_deployments gauge",
        `flags_deployments ${String(summaries.length)}`,
        "# HELP flags_defined_total Stored flag definitions across all deployments.",
        "# TYPE flags_defined_total gauge",
        `flags_defined_total ${String(definedTotal)}`,
        "# HELP flags_deployment_flags Stored flag definitions per deployment.",
        "# TYPE flags_deployment_flags gauge",
        ...summaries.map(
          (deployment) =>
            `flags_deployment_flags{deployment="${escapeLabelValue(deployment.id)}"} ${String(deployment.flagCount)}`,
        ),
        "# HELP flags_deployment_revision Stored document revision per deployment.",
        "# TYPE flags_deployment_revision gauge",
        ...summaries.map(
          (deployment) =>
            `flags_deployment_revision{deployment="${escapeLabelValue(deployment.id)}"} ${String(deployment.revision)}`,
        ),
        "# HELP flags_http_requests_total HTTP requests handled by the flags service.",
        "# TYPE flags_http_requests_total counter",
        ...Array.from(
          requests,
          ([key, count]) =>
            `flags_http_requests_total{${key}} ${String(count)}`,
        ),
        "",
      ].join("\n");
    },
  };
}
