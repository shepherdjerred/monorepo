import type {
  PollRunSummary,
  SummaryResponse,
} from "@shepherdjerred/feeds/shared/contract.ts";

export const PROMETHEUS_CONTENT_TYPE =
  "text/plain; version=0.0.4; charset=utf-8";

export type FeedsSurface = "console" | "reader";

export type FeedsRouteLabel =
  | "healthz"
  | "metrics"
  | "internal_refresh"
  | "greader_login"
  | "greader_token"
  | "greader_tags"
  | "greader_subscriptions"
  | "greader_stream_ids"
  | "greader_stream_contents"
  | "greader_edit_tag"
  | "greader_subscription_edit"
  | "greader_other"
  | "v1_summary"
  | "v1_entries"
  | "v1_feeds"
  | "v1_refresh"
  | "assets"
  | "client"
  | "other";

export type FeedsPollOutcome = "ok" | "skipped_flag" | "failed";

export type FeedsSummarySource =
  SummaryResponse | { readonly summary: () => SummaryResponse };

export type FeedsMetrics = {
  readonly recordRequest: (
    surface: FeedsSurface,
    route: FeedsRouteLabel,
    status: number,
  ) => void;
  readonly recordPollRun: (outcome: FeedsPollOutcome | PollRunSummary) => void;
  readonly render: (source: FeedsSummarySource) => string;
};

const POLL_OUTCOMES: readonly FeedsPollOutcome[] = [
  "ok",
  "skipped_flag",
  "failed",
];

const EXACT_GREADER_ROUTES: Readonly<Record<string, FeedsRouteLabel>> = {
  "/api/greader.php/accounts/ClientLogin": "greader_login",
  "/api/greader.php/reader/api/0/token": "greader_token",
  "/api/greader.php/reader/api/0/tag/list": "greader_tags",
  "/api/greader.php/reader/api/0/rename-tag": "greader_tags",
  "/api/greader.php/reader/api/0/disable-tag": "greader_tags",
  "/api/greader.php/reader/api/0/subscription/list": "greader_subscriptions",
  "/api/greader.php/reader/api/0/subscription/export": "greader_subscriptions",
  "/api/greader.php/reader/api/0/subscription/edit":
    "greader_subscription_edit",
  "/api/greader.php/reader/api/0/subscription/quickadd":
    "greader_subscription_edit",
  "/api/greader.php/reader/api/0/stream/items/ids": "greader_stream_ids",
  "/api/greader.php/reader/api/0/stream/items/contents":
    "greader_stream_contents",
  "/api/greader.php/reader/api/0/edit-tag": "greader_edit_tag",
  "/api/greader.php/reader/api/0/mark-all-as-read": "greader_edit_tag",
};

const EXACT_CONSOLE_ROUTES: Readonly<Record<string, FeedsRouteLabel>> = {
  "/metrics": "metrics",
  "/internal/refresh": "internal_refresh",
  "/api/v1/summary": "v1_summary",
  "/api/v1/refresh": "v1_refresh",
};

function classifyGreaderRoute(path: string): FeedsRouteLabel | undefined {
  const exact = EXACT_GREADER_ROUTES[path];
  if (exact !== undefined) return exact;
  return path === "/api/greader.php" || path.startsWith("/api/greader.php/")
    ? "greader_other"
    : undefined;
}

export function classifyFeedsRoute(
  surface: FeedsSurface,
  method: string,
  path: string,
  hasClient = false,
): FeedsRouteLabel {
  if (path === "/healthz") return "healthz";
  const greader = classifyGreaderRoute(path);
  if (greader !== undefined) return greader;
  if (surface === "reader") return "other";

  const exact = EXACT_CONSOLE_ROUTES[path];
  if (exact !== undefined) return exact;
  if (path === "/api/v1/entries" || path.startsWith("/api/v1/entries/")) {
    return "v1_entries";
  }
  if (path === "/api/v1/feeds" || path.startsWith("/api/v1/feeds/")) {
    return "v1_feeds";
  }
  if (path === "/assets" || path.startsWith("/assets/")) return "assets";

  const upperMethod = method.toUpperCase();
  const isReadMethod = upperMethod === "GET" || upperMethod === "HEAD";
  const isApiOrInternal =
    path === "/api" ||
    path.startsWith("/api/") ||
    path === "/internal" ||
    path.startsWith("/internal/");
  return hasClient && isReadMethod && !isApiOrInternal ? "client" : "other";
}

function resolveOutcome(
  input: FeedsPollOutcome | PollRunSummary,
): FeedsPollOutcome {
  if (typeof input === "string") return input;
  if (input.skippedByFlag) return "skipped_flag";
  return input.failed > 0 &&
    input.updated === 0 &&
    input.notModified === 0 &&
    input.polled > 0
    ? "failed"
    : "ok";
}

export function createFeedsMetrics(): FeedsMetrics {
  const requests = new Map<string, number>();
  const pollRuns = new Map<FeedsPollOutcome, number>(
    POLL_OUTCOMES.map((outcome) => [outcome, 0]),
  );

  return {
    recordRequest(surface, route, status) {
      const key = `surface="${surface}",route="${route}",status="${String(status)}"`;
      requests.set(key, (requests.get(key) ?? 0) + 1);
    },
    recordPollRun(input) {
      const outcome = resolveOutcome(input);
      pollRuns.set(outcome, (pollRuns.get(outcome) ?? 0) + 1);
    },
    render(source) {
      const summary = "summary" in source ? source.summary() : source;
      const lastPolledSeconds = summary.stats.lastPolledAt ?? 0;
      return [
        "# HELP feeds_subscriptions_total Configured feed subscriptions by ownership source.",
        "# TYPE feeds_subscriptions_total gauge",
        `feeds_subscriptions_total{source="code"} ${String(summary.stats.codeFeeds)}`,
        `feeds_subscriptions_total{source="user"} ${String(summary.stats.userFeeds)}`,
        "# HELP feeds_subscriptions_failing Feed subscriptions with consecutive poll failures.",
        "# TYPE feeds_subscriptions_failing gauge",
        `feeds_subscriptions_failing ${String(summary.stats.failingFeeds)}`,
        "# HELP feeds_entries_unread Unread feed entries.",
        "# TYPE feeds_entries_unread gauge",
        `feeds_entries_unread ${String(summary.views.unread)}`,
        "# HELP feeds_entries_starred Starred feed entries.",
        "# TYPE feeds_entries_starred gauge",
        `feeds_entries_starred ${String(summary.views.starred)}`,
        "# HELP feeds_entries_auto_read Entries matched by auto-read rules.",
        "# TYPE feeds_entries_auto_read gauge",
        `feeds_entries_auto_read ${String(summary.views.autoRead)}`,
        "# HELP feeds_last_poll_timestamp_seconds Unix timestamp of the most recent feed poll, or 0 if never polled.",
        "# TYPE feeds_last_poll_timestamp_seconds gauge",
        `feeds_last_poll_timestamp_seconds ${String(lastPolledSeconds)}`,
        "# HELP feeds_poll_runs_total Feed poll runs by outcome.",
        "# TYPE feeds_poll_runs_total counter",
        ...POLL_OUTCOMES.map(
          (outcome) =>
            `feeds_poll_runs_total{outcome="${outcome}"} ${String(pollRuns.get(outcome) ?? 0)}`,
        ),
        "# HELP feeds_http_requests_total HTTP requests handled by the feeds service.",
        "# TYPE feeds_http_requests_total counter",
        ...Array.from(
          requests,
          ([key, count]) =>
            `feeds_http_requests_total{${key}} ${String(count)}`,
        ),
        "",
      ].join("\n");
    },
  };
}
