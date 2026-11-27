import { Context, log } from "@temporalio/activity";
import {
  bearer,
  fetchJson,
  UpstreamError,
} from "@shepherdjerred/ops-clients/http.ts";
import { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";
import { WoodpeckerClient } from "@shepherdjerred/ops-clients/woodpecker.ts";
import {
  CiDashboardSampleSchema,
  CiTimingHistorySchema,
} from "@shepherdjerred/ops-model/ci-dashboard.ts";
import { collectCiDashboard } from "./collect.ts";
import { collectCiTimingHistory } from "./history.ts";

const CI_PATH = "/internal/v1/ops/ci";
const TIMINGS_PATH = "/internal/v1/ops/ci/timings";

function requiredEnvironment(key: string): string {
  const value = Bun.env[key]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${key} is required for the Hub CI dashboard collector`);
  }
  return value;
}

function runtime() {
  const repoId = Number(requiredEnvironment("WOODPECKER_REPO_ID"));
  if (!Number.isSafeInteger(repoId) || repoId <= 0) {
    throw new Error("WOODPECKER_REPO_ID must be a positive integer");
  }
  return {
    repoId,
    client: new WoodpeckerClient({
      baseUrl: requiredEnvironment("WOODPECKER_URL"),
      token: requiredEnvironment("WOODPECKER_TOKEN"),
      repoId,
    }),
    dashboardUrl: requiredEnvironment("OPS_DASHBOARD_URL"),
    token: requiredEnvironment("OPS_INGEST_TOKEN"),
    signal: Context.current().cancellationSignal,
  };
}

function onFailure(source: string, error: unknown): void {
  // Never log upstream response bodies, raw workflow config, or credentials.
  log.warn("Hub CI dashboard collection source unavailable", {
    source,
    status: error instanceof UpstreamError ? error.status : undefined,
    failure: error instanceof Error ? error.name : "UnknownError",
  });
}

async function publish(
  config: ReturnType<typeof runtime>,
  path: string,
  sample: unknown,
): Promise<void> {
  config.signal.throwIfAborted();
  const response = await fetch(new URL(path, config.dashboardUrl), {
    method: "POST",
    headers: { ...bearer(config.token), "content-type": "application/json" },
    body: JSON.stringify(sample),
    signal: AbortSignal.any([config.signal, AbortSignal.timeout(8000)]),
  });
  await response.body?.cancel();
  if (!response.ok) {
    throw new Error(
      `Hub CI collector POST ${path} returned HTTP ${String(response.status)}`,
    );
  }
}

export const opsCiDashboardActivities = {
  async collectAndPublishCiDashboard(): Promise<void> {
    const config = runtime();
    const sample = await collectCiDashboard({
      ...config,
      prometheus: new PrometheusClient({
        baseUrl: requiredEnvironment("PROMETHEUS_URL"),
      }),
      now: new Date(),
      signal: AbortSignal.any([config.signal, AbortSignal.timeout(27_000)]),
      onFailure,
    });
    await publish(config, CI_PATH, CiDashboardSampleSchema.parse(sample));
  },

  async refreshCiDashboardTimings(): Promise<void> {
    const config = runtime();
    const previous = await fetchJson(
      fetch,
      {
        upstream: "Hub CI timings",
        url: new URL(TIMINGS_PATH, config.dashboardUrl),
        init: { headers: bearer(config.token) },
        signal: config.signal,
        timeoutMs: 8000,
      },
      CiTimingHistorySchema.nullable(),
    );
    const history = await collectCiTimingHistory({
      ...config,
      previous,
      now: new Date(),
      signal: AbortSignal.any([config.signal, AbortSignal.timeout(75_000)]),
      onFailure,
    });
    await publish(config, TIMINGS_PATH, CiTimingHistorySchema.parse(history));
  },
};

export type OpsCiDashboardActivities = typeof opsCiDashboardActivities;
