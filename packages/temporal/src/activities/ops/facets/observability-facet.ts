import { z } from "zod";
import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import type { LokiClient } from "@shepherdjerred/ops-clients/loki.ts";
import type {
  PrometheusClient,
  PrometheusSample,
} from "@shepherdjerred/ops-clients/prometheus.ts";
import type { ObservabilityFacet } from "@shepherdjerred/ops-model/facets.ts";
import { GRAFANA_URL as PUBLIC_GRAFANA_URL } from "#activities/ops/ops-links.ts";

export const OBSERVABILITY_PROM_QUERIES = {
  headSeries: "sum(prometheus_tsdb_head_series)",
  walPlusBlocks:
    "sum(prometheus_tsdb_storage_blocks_bytes) + sum(prometheus_tsdb_wal_storage_bytes)",
  downTargets: "up == 0",
  topMetrics: 'topk(10, count by (__name__) ({__name__=~".+"}))',
  tempoSpanRate: "sum by (service) (rate(traces_spanmetrics_calls_total[5m]))",
  tempoErrorRate:
    'sum by (service) (rate(traces_spanmetrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m])) / clamp_min(sum by (service) (rate(traces_spanmetrics_calls_total[5m])), 1e-9)',
  tempoP95Ms:
    "histogram_quantile(0.95, sum by (service, le) (rate(traces_spanmetrics_latency_bucket[5m]))) * 1000",
} as const;

const GrafanaDashboardItemSchema = z
  .object({
    uid: z.string().min(1),
    title: z.string(),
    folderTitle: z.string().optional(),
    url: z.string().optional(),
  })
  .loose();

const GrafanaSearchSchema = z.array(GrafanaDashboardItemSchema);
const GrafanaDatasourcesSchema = z.array(z.unknown());

function firstScalar(samples: readonly PrometheusSample[]): number | null {
  const val = samples[0]?.value;
  return val !== undefined && Number.isFinite(val) ? val : null;
}

async function safeQuery(
  prometheus: PrometheusClient,
  query: string,
): Promise<PrometheusSample[]> {
  try {
    return await prometheus.query(query, AbortSignal.timeout(8000));
  } catch {
    return [];
  }
}

async function collectPrometheusObservability(
  prometheus: PrometheusClient | undefined,
): Promise<ObservabilityFacet["prometheus"]> {
  if (prometheus === undefined) {
    return {
      headSeries: null,
      walPlusBlocksBytes: null,
      downTargets: [],
      topMetricNames: [],
    };
  }
  const [headSamples, walSamples, downSamples, topSamples] = await Promise.all([
    safeQuery(prometheus, OBSERVABILITY_PROM_QUERIES.headSeries),
    safeQuery(prometheus, OBSERVABILITY_PROM_QUERIES.walPlusBlocks),
    safeQuery(prometheus, OBSERVABILITY_PROM_QUERIES.downTargets),
    safeQuery(prometheus, OBSERVABILITY_PROM_QUERIES.topMetrics),
  ]);

  const downTargets = downSamples.map((s) => ({
    job: s.metric["job"] ?? "unknown",
    instance: s.metric["instance"] ?? "unknown",
    health: "down",
  }));

  const topMetricNames = topSamples
    .filter((s) => Number.isFinite(s.value))
    .map((s) => ({
      name: s.metric["__name__"] ?? "unknown",
      series: Math.round(s.value),
    }))
    .sort((a, b) => b.series - a.series);

  const headVal = firstScalar(headSamples);
  const walVal = firstScalar(walSamples);

  return {
    headSeries: headVal === null ? null : Math.round(headVal),
    walPlusBlocksBytes: walVal === null ? null : Math.round(walVal),
    downTargets,
    topMetricNames,
  };
}

async function collectTempoRedObservability(
  prometheus: PrometheusClient | undefined,
): Promise<ObservabilityFacet["tempo"]> {
  if (prometheus === undefined) {
    return { servicesRed: [] };
  }
  const [rateSamples, errSamples, p95Samples] = await Promise.all([
    safeQuery(prometheus, OBSERVABILITY_PROM_QUERIES.tempoSpanRate),
    safeQuery(prometheus, OBSERVABILITY_PROM_QUERIES.tempoErrorRate),
    safeQuery(prometheus, OBSERVABILITY_PROM_QUERIES.tempoP95Ms),
  ]);

  const errByService = new Map<string, number>();
  for (const s of errSamples) {
    const svc = s.metric["service"] ?? "";
    if (svc !== "" && Number.isFinite(s.value)) {
      errByService.set(svc, Math.max(0, Math.min(1, s.value)));
    }
  }
  const p95ByService = new Map<string, number>();
  for (const s of p95Samples) {
    const svc = s.metric["service"] ?? "";
    if (svc !== "" && Number.isFinite(s.value)) {
      p95ByService.set(svc, Math.round(s.value * 10) / 10);
    }
  }

  const servicesRed = rateSamples
    .flatMap((s): ObservabilityFacet["tempo"]["servicesRed"] => {
      const service = s.metric["service"] ?? "";
      if (service === "" || !Number.isFinite(s.value)) {
        return [];
      }
      return [
        {
          service,
          spanRate: Math.round(s.value * 100) / 100,
          errorRate:
            Math.round((errByService.get(service) ?? 0) * 10_000) / 10_000,
          p95Ms: p95ByService.get(service) ?? null,
        },
      ];
    })
    .sort(
      (a, b) => b.spanRate - a.spanRate || a.service.localeCompare(b.service),
    );

  return { servicesRed };
}

async function collectLokiObservability(
  loki: LokiClient | undefined,
  now: Date,
): Promise<ObservabilityFacet["loki"]> {
  if (loki === undefined) {
    return {
      ingestedBytes24h: null,
      noisyNamespaces: [],
      warningEvents: [],
      rulerRulesCount: 0,
    };
  }
  const [volSettled, errSettled, warnSettled, rulesSettled] =
    await Promise.allSettled([
      loki.namespaceVolume24h(now),
      loki.errorVolumeByNamespace("1h", now),
      loki.warningEvents1h(now),
      loki.rulerRulesCount(),
    ]);

  const volumes = volSettled.status === "fulfilled" ? volSettled.value : null;
  const errors = errSettled.status === "fulfilled" ? errSettled.value : [];
  const warnings = warnSettled.status === "fulfilled" ? warnSettled.value : [];
  const rulerRulesCount =
    rulesSettled.status === "fulfilled" ? rulesSettled.value : 0;

  const errByNs = new Map(
    errors.map((e) => [e.namespace, Math.round(e.lines)]),
  );
  const ingestedBytes24h =
    volumes === null
      ? null
      : Math.round(volumes.reduce((sum, v) => sum + v.bytes, 0));

  const noisyNamespaces = (volumes ?? []).slice(0, 15).map((v) => ({
    namespace: v.namespace,
    bytes24h: Math.round(v.bytes),
    errorLines1h: errByNs.get(v.namespace) ?? 0,
  }));

  const warningEvents = warnings.slice(0, 20).map((w) => ({
    namespace: w.namespace,
    reason: w.reason,
    count1h: Math.round(w.count),
  }));

  return {
    ingestedBytes24h,
    noisyNamespaces,
    warningEvents,
    rulerRulesCount,
  };
}

async function fetchGrafanaDashboards(
  baseUrl: string,
  headers: Record<string, string>,
  fetchImpl: Fetch,
): Promise<ObservabilityFacet["grafana"]["dashboards"]> {
  try {
    const response = await fetchImpl(
      new URL("/api/search?type=dash-db&limit=500", baseUrl),
      { headers, signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return [];
    }
    const parsed = GrafanaSearchSchema.safeParse(await response.json());
    if (!parsed.success) {
      return [];
    }
    return parsed.data.map((d) => ({
      uid: d.uid,
      title: d.title,
      ...(d.folderTitle === undefined ? {} : { folder: d.folderTitle }),
      url:
        d.url?.startsWith("http") === true
          ? d.url
          : `${PUBLIC_GRAFANA_URL}${d.url ?? `/d/${encodeURIComponent(d.uid)}`}`,
    }));
  } catch {
    return [];
  }
}

async function fetchGrafanaDatasourcesCount(
  baseUrl: string,
  headers: Record<string, string>,
  fetchImpl: Fetch,
): Promise<number> {
  try {
    const response = await fetchImpl(new URL("/api/datasources", baseUrl), {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return 0;
    }
    const parsed = GrafanaDatasourcesSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.length : 0;
  } catch {
    return 0;
  }
}

async function collectGrafanaObservability(input: {
  grafanaUrl?: string | undefined;
  grafanaApiKey?: string | undefined;
  fetchImpl: Fetch;
}): Promise<ObservabilityFacet["grafana"]> {
  const baseUrl = (input.grafanaUrl ?? Bun.env["GRAFANA_URL"] ?? "").trim();
  if (baseUrl === "") {
    return { datasourcesCount: 0, dashboardsCount: 0, dashboards: [] };
  }
  const apiKey = (
    input.grafanaApiKey ??
    Bun.env["GRAFANA_API_KEY"] ??
    ""
  ).trim();
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(apiKey === "" ? {} : { authorization: `Bearer ${apiKey}` }),
  };

  const [dashboards, datasourcesCount] = await Promise.all([
    fetchGrafanaDashboards(baseUrl, headers, input.fetchImpl),
    fetchGrafanaDatasourcesCount(baseUrl, headers, input.fetchImpl),
  ]);

  return {
    datasourcesCount,
    dashboardsCount: dashboards.length,
    dashboards,
  };
}

export async function collectObservabilityFacet(input: {
  prometheus?: PrometheusClient;
  loki?: LokiClient;
  grafanaUrl?: string | undefined;
  grafanaApiKey?: string | undefined;
  fetchImpl?: Fetch;
  now?: Date;
}): Promise<ObservabilityFacet> {
  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const [prometheus, tempo, loki, grafana] = await Promise.all([
    collectPrometheusObservability(input.prometheus),
    collectTempoRedObservability(input.prometheus),
    collectLokiObservability(input.loki, now),
    collectGrafanaObservability({
      grafanaUrl: input.grafanaUrl,
      grafanaApiKey: input.grafanaApiKey,
      fetchImpl,
    }),
  ]);

  return {
    prometheus,
    loki,
    tempo,
    grafana,
  };
}
