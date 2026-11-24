import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import {
  createFlagMetricSet,
  createFlagMetricsRecorder,
} from "@shepherdjerred/feature-flags/observability.ts";

export type ListenerLabel = "public" | "staff" | "ingest";
export type IngestBatchOutcome =
  "accepted" | "unauthorized" | "disabled" | "invalid" | "too_large";

const KNOWN_EXACT_ROUTES = new Set([
  "/healthz",
  "/readyz",
  "/metrics",
  "/api/v1/viewer",
  "/api/v1/overview",
  "/api/v1/activity",
  "/api/v1/players",
  "/api/v1/pvp",
  "/api/v1/gameplay",
  "/api/v1/ingest",
  "/api/staff/network",
  "/api/staff/bounces",
  "/api/staff/query",
]);

export function classifyMetricRoute(pathname: string): string {
  if (KNOWN_EXACT_ROUTES.has(pathname)) {
    return pathname;
  }
  if (/^\/api\/v1\/players\/[^/]+$/u.test(pathname)) {
    return "/api/v1/players/:id";
  }
  if (/^\/api\/staff\/players\/[^/]+\/raw$/u.test(pathname)) {
    return "/api/staff/players/:id/raw";
  }
  if (/^\/api\/staff\/players\/[^/]+$/u.test(pathname)) {
    return "/api/staff/players/:id";
  }
  if (pathname.startsWith("/api/")) {
    return "/api/:unknown";
  }
  return pathname.startsWith("/assets/") ? "/assets/*" : "/:spa";
}

export function createStormStatsMetrics(options?: {
  readonly register?: Registry;
  readonly collectDefaults?: boolean;
}) {
  const register = options?.register ?? new Registry();
  register.setDefaultLabels({ service: "storm-stats" });
  if (options?.collectDefaults === true) {
    collectDefaultMetrics({ register, prefix: "storm_stats_" });
  }

  const httpRequestsTotal = new Counter({
    name: "storm_stats_http_requests_total",
    help: "HTTP requests handled by storm-stats across listeners",
    labelNames: ["listener", "method", "route", "status"] as const,
    registers: [register],
  });

  const httpRequestDurationSeconds = new Histogram({
    name: "storm_stats_http_request_duration_seconds",
    help: "HTTP request latency in seconds across storm-stats listeners",
    labelNames: ["listener", "method", "route"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
  });

  const ingestBatchesTotal = new Counter({
    name: "storm_stats_ingest_batches_total",
    help: "Ingest batch requests by bounded outcome",
    labelNames: ["result"] as const,
    registers: [register],
  });

  const ingestEventsTotal = new Counter({
    name: "storm_stats_ingest_events_total",
    help: "Ingested analytics events by idempotency outcome",
    labelNames: ["outcome"] as const,
    registers: [register],
  });

  const playersTotal = new Gauge({
    name: "storm_stats_players_total",
    help: "Total unique players stored in storm-stats",
    registers: [register],
  });

  const onlinePlayersGauge = new Gauge({
    name: "storm_stats_online_players",
    help: "Players online in the most recent server snapshot",
    registers: [register],
  });

  const featureFlags = createFlagMetricsRecorder(
    createFlagMetricSet({
      counter: (definition) =>
        new Counter({ ...definition, registers: [register] }),
      gauge: (definition) =>
        new Gauge({ ...definition, registers: [register] }),
    }),
  );

  return {
    register,
    httpRequestsTotal,
    httpRequestDurationSeconds,
    ingestBatchesTotal,
    ingestEventsTotal,
    playersTotal,
    onlinePlayersGauge,
    featureFlags,
  };
}

export type StormStatsMetrics = ReturnType<typeof createStormStatsMetrics>;
