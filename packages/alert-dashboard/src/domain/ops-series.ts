import {
  SeriesTargetSchema,
  type SeriesPresetId,
  type SeriesRange,
  type SeriesUnit,
} from "#shared/ops-schema";
import {
  LIVE_LLM_COST,
  multi,
  PLATFORM_SERIES_PRESETS,
  single,
} from "./ops-series-platform-presets.ts";

export type SeriesPreset = {
  title: string;
  unit: SeriesUnit;
  queries: readonly {
    promql: string;
    /** Label whose value names each series; absent means one fixed name. */
    legendLabel?: string;
    /** Name when the query has no legend label, or the label is missing. */
    name: string;
  }[];
};

/**
 * Resolve node-exporter series to clean `node` names: prefer direct `node`
 * labels, join `(namespace, pod)` against `kube_pod_info` when `node` is
 * absent, and fall back to `instance` when neither is available.
 */
function byNodeOrInstance(
  directByNode: string,
  byPodAndInstanceWithoutNode: string,
): string {
  const podJoin = 'max by (namespace, pod, node) (kube_pod_info{node!=""})';
  return `(${directByNode}) or max by (node) ((${byPodAndInstanceWithoutNode}) * on (namespace, pod) group_left (node) ${podJoin}) or max by (node) (label_replace((${byPodAndInstanceWithoutNode}) unless on (namespace, pod) ${podJoin}, "node", "$1", "instance", "(.+)"))`;
}

const NODE_CPU_PROMQL = byNodeOrInstance(
  '1 - avg by (node) (rate(node_cpu_seconds_total{mode="idle",node!=""}[{window}]))',
  '1 - avg by (namespace, pod, instance) (rate(node_cpu_seconds_total{mode="idle",node=""}[{window}]))',
);

const NODE_MEMORY_PROMQL = byNodeOrInstance(
  '1 - sum by (node) (node_memory_MemAvailable_bytes{node!=""}) / sum by (node) (node_memory_MemTotal_bytes{node!=""})',
  '1 - sum by (namespace, pod, instance) (node_memory_MemAvailable_bytes{node=""}) / sum by (namespace, pod, instance) (node_memory_MemTotal_bytes{node=""})',
);

const WOODPECKER_PIPES_PROMQL =
  'sum by (label_ci_sjer_red_step_key) (max by (namespace, pod) (kube_pod_status_phase{namespace="woodpecker-ci",phase="Running"} == 1) * on (namespace, pod) group_left (label_ci_sjer_red_step_key) max by (namespace, pod, label_ci_sjer_red_step_key) (kube_pod_labels{namespace="woodpecker-ci",label_ci_sjer_red_step_key!=""}))';

const TURBO_HIT_PROMQL =
  'sum(rate(container_network_transmit_bytes_total{namespace="ci-cache"}[{window}])) / clamp_min(sum(rate(container_network_transmit_bytes_total{namespace="ci-cache"}[{window}])) + sum(rate(container_network_receive_bytes_total{namespace="ci-cache"}[{window}])), 1e-9)';

/**
 * Named PromQL presets. The browser picks a preset id and a range; it never
 * sends PromQL. `{window}` is replaced with the range's step (at least 5m) so
 * `increase`/`rate` buckets line up with the plotted points, and `{target}` is
 * replaced with a validated regex target (or `.+` when omitted).
 */
export const SERIES_PRESETS: Record<SeriesPresetId, SeriesPreset> = {
  // Core / Hub 1.0 presets (with PromQL fixes)
  "ai-cost-by-source": single(
    "AI cost by source",
    "usd",
    "sum by (source) (increase(ai_usage_cost_usd_total[{window}]))",
    { legendLabel: "source", name: "cost" },
  ),
  "ai-tokens-by-tool": single(
    "AI tokens by tool",
    "tokens",
    "sum by (source) (increase(ai_usage_tokens_total[{window}]))",
    { legendLabel: "source", name: "tokens" },
  ),
  "ai-quota": single(
    "Subscription quota used",
    "ratio",
    'label_join(max by (provider, window_kind) (ai_subscription_quota_used_ratio), "series", " ", "provider", "window_kind")',
    { legendLabel: "series", name: "quota" },
  ),
  "cluster-llm-cost": single(
    "Cluster LLM cost by service",
    "usd",
    `sum by (exported_service) (${LIVE_LLM_COST})`,
    { legendLabel: "exported_service", name: "llm" },
  ),
  "provider-billed-cost": single(
    "Provider-billed LLM cost today",
    "usd",
    'sum by (provider) (last_over_time(llm_billed_cost_usd{window="today"}[2h]))',
    { legendLabel: "provider", name: "billed" },
  ),
  "prs-open": single(
    "Open pull requests",
    "count",
    "sum by (author_class) (github_pull_requests_open)",
    { legendLabel: "author_class", name: "open" },
  ),
  "prs-merged": single(
    "Pull requests merged (7d)",
    "count",
    "sum by (author_class) (github_pull_requests_merged_7d)",
    { legendLabel: "author_class", name: "merged 7d" },
  ),
  "renovate-pending": single(
    "Renovate updates pending",
    "count",
    "sum by (state) (renovate_updates_pending)",
    { legendLabel: "state", name: "pending" },
  ),
  "bugsink-unresolved": single(
    "Unresolved Bugsink issues",
    "count",
    "sum(bugsink_issues_unresolved)",
    { name: "unresolved" },
  ),
  "tracker-open": single(
    "Open Tracker issues",
    "count",
    "sum by (state_type) (tracker_issues_open)",
    { legendLabel: "state_type", name: "open" },
  ),
  "alerts-firing": single(
    "Firing alerts",
    "count",
    'sum by (severity) (ALERTS{alertstate="firing"})',
    { legendLabel: "severity", name: "firing" },
  ),
  "node-cpu": single("Node CPU used", "ratio", NODE_CPU_PROMQL, {
    legendLabel: "node",
    name: "cpu",
  }),
  "node-memory": single("Node memory used", "ratio", NODE_MEMORY_PROMQL, {
    legendLabel: "node",
    name: "memory",
  }),

  // Engineering / Renovate / CI
  "renovate-merges-7d": single(
    "Renovate merges (7d)",
    "count",
    'sum(github_pull_requests_merged_7d{author_class="renovate"})',
    { name: "merged 7d" },
  ),
  "pr-oldest-age": single(
    "Oldest open PR age",
    "seconds",
    "max by (author_class) (github_pull_request_oldest_open_age_seconds)",
    { legendLabel: "author_class", name: "oldest" },
  ),
  "github-rate-limit": single(
    "GitHub API rate limit remaining",
    "count",
    "min by (resource) (github_rate_limit_remaining)",
    { legendLabel: "resource", name: "remaining" },
  ),
  "woodpecker-pipelines": single(
    "Woodpecker active CI pods",
    "count",
    WOODPECKER_PIPES_PROMQL,
    { legendLabel: "label_ci_sjer_red_step_key", name: "running" },
  ),
  "kueue-pending-workloads": single(
    "Kueue pending workloads",
    "count",
    'sum by (status) (kueue_pending_workloads{cluster_queue="woodpecker"})',
    { legendLabel: "status", name: "pending" },
  ),
  "kueue-cpu-quota": multi("Kueue CPU usage vs reservation", "count", [
    [
      "used",
      'sum(kueue_local_queue_resource_usage{exported_namespace="woodpecker-ci",name="default",resource="cpu"})',
    ],
    [
      "reserved",
      'sum(kueue_local_queue_resource_reservation{exported_namespace="woodpecker-ci",name="default",resource="cpu"})',
    ],
  ]),
  "turbo-hit-ratio": single(
    "Turborepo cache hit ratio",
    "ratio",
    TURBO_HIT_PROMQL,
    { name: "egress share" },
  ),
  "turbo-network-bps": multi("CI cache network throughput", "bps", [
    [
      "egress (hits)",
      'sum(rate(container_network_transmit_bytes_total{namespace="ci-cache"}[{window}]))',
    ],
    [
      "ingress (puts)",
      'sum(rate(container_network_receive_bytes_total{namespace="ci-cache"}[{window}]))',
    ],
  ]),
  "delivery-active": single(
    "Active Delivery deployments",
    "count",
    'sum by (status) (delivery_deployments{job="delivery",status!~"succeeded|failed|canceled"})',
    { legendLabel: "status", name: "active" },
  ),
  "delivery-outcomes": single(
    "Delivery deployments by outcome",
    "count",
    'sum by (status) (delivery_deployments{job="delivery",status=~"succeeded|failed|canceled"})',
    { legendLabel: "status", name: "deployments" },
  ),
  "argocd-sync-status": single(
    "Argo CD applications by sync status",
    "count",
    "count by (sync_status) (argocd_app_info)",
    { legendLabel: "sync_status", name: "apps" },
  ),
  "argocd-health-status": single(
    "Argo CD applications by health",
    "count",
    "count by (health_status) (argocd_app_info)",
    { legendLabel: "health_status", name: "apps" },
  ),

  // Product / PostHog / Gaming / Media
  "posthog-pageviews-by-site": single(
    "PostHog pageviews (24h) by site",
    "count",
    "sum by (site) (posthog_site_pageviews_24h)",
    { legendLabel: "site", name: "pageviews" },
  ),
  "posthog-dau-by-site": single(
    "PostHog daily active users by site",
    "count",
    "sum by (site) (posthog_site_dau_24h)",
    { legendLabel: "site", name: "dau" },
  ),
  "posthog-lcp-p75": single(
    "PostHog p75 LCP by site",
    "ms",
    "max by (site) (posthog_site_lcp_p75_ms)",
    { legendLabel: "site", name: "p75 lcp" },
  ),
  "scout-guilds": single(
    "Scout Discord guilds",
    "count",
    "max by (environment) (discord_guilds)",
    { legendLabel: "environment", name: "guilds" },
  ),
  "scout-matches": single(
    "Scout tracked players",
    "count",
    "max by (environment) (players_tracked_total)",
    { legendLabel: "environment", name: "players" },
  ),
  "scout-riot-requests": single(
    "Scout Riot API request rate",
    "count",
    "sum by (environment) (rate(riot_api_requests_total[{window}]))",
    { legendLabel: "environment", name: "req/s" },
  ),
  "storm-players": single(
    "Minecraft online players",
    "count",
    'max by (namespace) (mc_players_online_total{namespace=~"minecraft-.*"})',
    { legendLabel: "namespace", name: "players" },
  ),
  "storm-brain-requests": single(
    "StormBrain requests",
    "count",
    "sum by (outcome) (increase(storm_brain_requests_total[{window}]))",
    { legendLabel: "outcome", name: "requests" },
  ),
  "media-hdd-usage": single(
    "Media HDD volume usage",
    "bytes",
    'max by (persistentvolumeclaim) (kubelet_volume_stats_used_bytes{namespace="media",persistentvolumeclaim=~"plex-.*-hdd-pvc"})',
    { legendLabel: "persistentvolumeclaim", name: "used" },
  ),
  "qbittorrent-throughput": multi("qBittorrent transfer throughput", "bps", [
    ["download", "sum(qbittorrent_global_download_speed_bytes)"],
    ["upload", "sum(qbittorrent_global_upload_speed_bytes)"],
  ]),
  "plex-watch-hours": single(
    "Plex watch hours",
    "hours",
    'sum(avg_over_time(sessions_count{job="media-plex-metrics-service"}[{window}])) * ({window_seconds} / 3600)',
    { name: "watch hours" },
  ),
  "golink-redirects": single(
    "Golink redirects",
    "count",
    "sum by (kind) (increase(golink_redirects_total[{window}]))",
    { legendLabel: "kind", name: "redirects" },
  ),
  ...PLATFORM_SERIES_PRESETS,
};

/** Range length and plotted step; every range yields at most ~300 points. */
export const SERIES_RANGE_SECONDS: Record<
  SeriesRange,
  { durationSeconds: number; stepSeconds: number }
> = {
  "24h": { durationSeconds: 24 * 3600, stepSeconds: 300 },
  "7d": { durationSeconds: 7 * 24 * 3600, stepSeconds: 3600 },
  "30d": { durationSeconds: 30 * 24 * 3600, stepSeconds: 4 * 3600 },
  "90d": { durationSeconds: 90 * 24 * 3600, stepSeconds: 12 * 3600 },
};

const MIN_WINDOW_SECONDS = 300;

export type PlannedRangeQuery = {
  promql: string;
  legendLabel?: string;
  name: string;
  startSeconds: number;
  endSeconds: number;
  stepSeconds: number;
};

function sanitizeTargetPattern(target: string | undefined): string {
  return target === undefined
    ? ".+"
    : SeriesTargetSchema.parse(target).replaceAll(".", String.raw`\.`);
}

/**
 * Expand a preset into concrete range queries. Start and end snap to the step
 * grid so every query in a preset returns points on the same timestamps.
 */
export function planSeries(
  preset: SeriesPresetId,
  range: SeriesRange,
  nowSeconds: number,
  target?: string,
): PlannedRangeQuery[] {
  const { durationSeconds, stepSeconds } = SERIES_RANGE_SECONDS[range];
  const endSeconds = Math.floor(nowSeconds / stepSeconds) * stepSeconds;
  const startSeconds = endSeconds - durationSeconds;
  const windowSeconds = Math.max(stepSeconds, MIN_WINDOW_SECONDS);
  const window = `${String(windowSeconds)}s`;
  const targetPattern = sanitizeTargetPattern(target);
  return SERIES_PRESETS[preset].queries.map((query) => ({
    ...query,
    promql: query.promql
      .replaceAll("{window}", window)
      .replaceAll("{window_seconds}", String(windowSeconds))
      .replaceAll("{target}", targetPattern),
    startSeconds,
    endSeconds,
    stepSeconds,
  }));
}

/** Instant queries the weekly review compares against the prior week. */
export const REVIEW_QUERIES = {
  aiSpend7d: "sum(increase(ai_usage_cost_usd_total[7d]))",
  aiSpendPrevious7d: "sum(increase(ai_usage_cost_usd_total[7d] offset 7d))",
  llmSpend7d: `sum(${LIVE_LLM_COST.replaceAll("[{window}]", "[7d]")})`,
  llmSpendPrevious7d: `sum(${LIVE_LLM_COST.replaceAll("[{window}]", "[7d] offset 7d")})`,
} as const;
