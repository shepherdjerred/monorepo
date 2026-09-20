import { z } from "zod/v4";

const PrometheusResponseSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    result: z.array(
      z.looseObject({ value: z.tuple([z.number(), z.string()]) }),
    ),
  }),
});
const GrafanaDashboardSchema = z.looseObject({ dashboard: z.unknown() });

type ObservabilityDefinition = {
  id: string;
  query: string;
  minimumRequiredSeries: number;
  minimumValue?: number;
  maximumValue?: number;
};

export type CiIoObservabilityResult = ObservabilityDefinition & {
  series: number;
  values: number[];
  passed: boolean;
};

/**
 * Nodes currently running a CI step pod.
 *
 * Joined through the step-key label the configuration extension stamps, since
 * Woodpecker itself puts nothing identifying on a step pod. See
 * packages/woodpecker-config-extension/src/pipeline/emit.ts.
 */
const ACTIVE_NODES =
  'max by (node) (kube_pod_info{namespace="woodpecker"} * on (namespace, pod) group_left kube_pod_labels{namespace="woodpecker", label_ci_sjer_red_step_key!=""})';
const DISKS = "nvme[0-9]+n[0-9]+|sd[a-z]+|vd[a-z]+|xvd[a-z]+";

const QUERIES: readonly ObservabilityDefinition[] = [
  {
    // Successor to the agent-stack-k8s monitor check: the server is what holds
    // scheduling state now, and its metrics endpoint is only scraped when the
    // PodMonitor's bearer token is accepted.
    id: "server-metrics-discovery",
    query: 'max(woodpecker_worker_count{namespace="woodpecker"})',
    minimumRequiredSeries: 1,
    minimumValue: 1,
  },
  {
    id: "raw-write-series",
    query: "woodpecker:pod_parent_fs_writes_bytes_total",
    minimumRequiredSeries: 1,
  },
  {
    id: "job-write-series",
    query: "woodpecker:pod_parent_fs_writes_bytes_by_job_total",
    minimumRequiredSeries: 1,
  },
  {
    id: "recording-rule-groups",
    query:
      'prometheus_rule_group_last_evaluation_timestamp_seconds{rule_group=~".*woodpecker-ci-io-(recording|rollups|alerts).*"}',
    minimumRequiredSeries: 3,
  },
  {
    id: "recording-rule-freshness",
    query:
      'time() - max(prometheus_rule_group_last_evaluation_timestamp_seconds{rule_group=~".*woodpecker-ci-io-(recording|rollups|alerts).*"})',
    minimumRequiredSeries: 1,
    maximumValue: 300,
  },
  {
    id: "recording-rule-duration",
    query:
      'max(prometheus_rule_group_last_duration_seconds{rule_group=~".*woodpecker-ci-io-(recording|rollups|alerts).*"})',
    minimumRequiredSeries: 1,
    maximumValue: 1,
  },
  {
    id: "recording-rule-failures",
    query:
      'sum(increase(prometheus_rule_evaluation_failures_total{rule_group=~".*woodpecker-ci-io-(recording|rollups|alerts).*"}[1h]))',
    minimumRequiredSeries: 1,
    maximumValue: 0,
  },
  {
    id: "ci-io-alert-state",
    query:
      'count(ALERTS{alertname=~"WoodpeckerCI.*", alertstate="firing"}) or vector(0)',
    minimumRequiredSeries: 1,
    maximumValue: 0,
  },
  {
    id: "ci-io-recording-series-budget",
    query: 'count({__name__=~"woodpecker:.*"})',
    minimumRequiredSeries: 1,
    maximumValue: 2000,
  },
  {
    id: "prometheus-pvc-growth-24h",
    query:
      'max(delta(kubelet_volume_stats_used_bytes{namespace="prometheus", persistentvolumeclaim=~"prometheus-prometheus-kube-prometheus-prometheus.*"}[24h]))',
    minimumRequiredSeries: 1,
    maximumValue: 1_073_741_824,
  },
  {
    id: "logical-write-rate",
    query: "sum(rate(woodpecker:pod_parent_fs_writes_bytes_total[5m]))",
    minimumRequiredSeries: 1,
  },
  {
    id: "physical-write-rate",
    query: `sum(rate(node_disk_written_bytes_total{device=~"${DISKS}"}[5m]) and on (node) ${ACTIVE_NODES})`,
    minimumRequiredSeries: 1,
  },
  {
    id: "pod-io-pressure",
    query: "sum(rate(woodpecker:pod_parent_io_waiting_seconds_total[5m]))",
    minimumRequiredSeries: 1,
  },
  {
    id: "node-io-pressure",
    query: `sum(rate(node_pressure_io_waiting_seconds_total[5m]) and on (node) ${ACTIVE_NODES})`,
    minimumRequiredSeries: 1,
  },
  {
    id: "disk-write-latency",
    query: `sum by (node, device) (rate(node_disk_write_time_seconds_total{device=~"${DISKS}"}[5m]) and on (node) ${ACTIVE_NODES}) / clamp_min(sum by (node, device) (rate(node_disk_writes_completed_total{device=~"${DISKS}"}[5m]) and on (node) ${ACTIVE_NODES}), 1e-9)`,
    minimumRequiredSeries: 1,
  },
  {
    id: "disk-queue-depth",
    query: `rate(node_disk_io_time_weighted_seconds_total{device=~"${DISKS}"}[5m]) and on (node) ${ACTIVE_NODES}`,
    minimumRequiredSeries: 1,
  },
];

export function evaluateCiIoObservability(
  definition: ObservabilityDefinition,
  values: number[],
  series: number,
): boolean {
  if (series < definition.minimumRequiredSeries) return false;
  const minimumValue = definition.minimumValue;
  if (
    minimumValue !== undefined &&
    values.some((value) => value < minimumValue)
  ) {
    return false;
  }
  const maximumValue = definition.maximumValue;
  return (
    maximumValue === undefined || values.every((value) => value <= maximumValue)
  );
}

async function prometheusCheck(
  base: string,
  definition: ObservabilityDefinition,
): Promise<CiIoObservabilityResult> {
  const url = new URL("/api/v1/query", base);
  url.searchParams.set("query", definition.query);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(
      `Prometheus query ${definition.id} failed with HTTP ${response.status.toString()}`,
    );
  }
  const parsed = PrometheusResponseSchema.parse(await response.json());
  const values = parsed.data.result.map((sample) => Number(sample.value[1]));
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(
      `Prometheus query ${definition.id} returned a non-numeric value`,
    );
  }
  return {
    ...definition,
    series: parsed.data.result.length,
    values,
    passed: evaluateCiIoObservability(
      definition,
      values,
      parsed.data.result.length,
    ),
  };
}

function collectTitles(value: unknown): string[] {
  if (Array.isArray(value))
    return value.flatMap((entry) => collectTitles(entry));
  const record = z.record(z.string(), z.unknown()).safeParse(value);
  if (!record.success) return [];
  return [
    ...(typeof record.data["title"] === "string" ? [record.data["title"]] : []),
    ...Object.values(record.data).flatMap((entry) => collectTitles(entry)),
  ];
}

async function dashboardCheck(): Promise<CiIoObservabilityResult> {
  const base = Bun.env["GRAFANA_URL"];
  const token = Bun.env["GRAFANA_API_KEY"];
  if (
    base === undefined ||
    base === "" ||
    token === undefined ||
    token === ""
  ) {
    throw new Error("GRAFANA_URL and GRAFANA_API_KEY are required");
  }
  const url = new URL("/api/dashboards/uid/ci-capacity-dashboard", base);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(
      `Grafana CI dashboard returned HTTP ${response.status.toString()}`,
    );
  }
  const titles = new Set(
    collectTitles(
      GrafanaDashboardSchema.parse(await response.json()).dashboard,
    ),
  );
  // Titles must match addCiIoPanels in
  // packages/homelab/src/cdk8s/grafana/shared/ci-capacity-panels.ts. Checking
  // by title is the point: a panel whose query silently returns nothing still
  // renders, so presence is the weakest claim worth asserting here, and the
  // Prometheus checks above cover whether the series exist.
  const required = [
    "Logical Write Rate",
    "Node Physical Write Rate",
    "CI Pod I/O Pressure",
    "Node I/O Pressure",
    "Disk Write Latency",
    "Disk Queue Depth (Diagnostic)",
    "CI I/O Recording Series",
    "Prometheus Storage Growth (24h)",
  ];
  const count = required.filter((title) => titles.has(title)).length;
  return {
    id: "grafana-dashboard-panels",
    query: url.toString(),
    minimumRequiredSeries: required.length,
    series: count,
    values: [count],
    passed: count === required.length,
  };
}

export async function collectCiIoObservability(): Promise<
  CiIoObservabilityResult[]
> {
  const base = Bun.env["PROMETHEUS_URL"];
  if (base === undefined || base === "") {
    throw new Error("PROMETHEUS_URL is required");
  }
  const prometheus = await Promise.all(
    QUERIES.map(async (definition) => prometheusCheck(base, definition)),
  );
  return [await dashboardCheck(), ...prometheus];
}

export const ciIoObservabilityActivities = { collectCiIoObservability };
export type CiIoObservabilityActivities = typeof ciIoObservabilityActivities;
