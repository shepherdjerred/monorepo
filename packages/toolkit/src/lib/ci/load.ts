import { z } from "zod";
import { captureJson } from "./process.ts";
import { sanitizeText } from "./redaction.ts";
import { ciPods } from "./pods.ts";
import { woodpeckerJson, type WoodpeckerConfig } from "#lib/woodpecker/ci.ts";

const QueueSchema = z.object({
  paused: z.boolean(),
  stats: z.object({
    worker_count: z.number(),
    pending_count: z.number(),
    running_count: z.number(),
    waiting_on_deps_count: z.number(),
  }),
});
const ResourceSchema = z.object({
  name: z.string(),
  nominalQuota: z.string().optional(),
  total: z.string().optional(),
});
const FlavorSchema = z.object({
  name: z.string(),
  resources: z.array(ResourceSchema),
});
const AdmissionSchema = z.object({
  spec: z.object({
    resourceGroups: z.array(z.object({ flavors: z.array(FlavorSchema) })),
  }),
  status: z.object({
    pendingWorkloads: z.number(),
    admittedWorkloads: z.number(),
    flavorsReservation: z.array(FlavorSchema),
    flavorsUsage: z.array(FlavorSchema),
  }),
});
const MetricsSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    resultType: z.literal("vector"),
    result: z.array(
      z.object({
        metric: z.record(z.string(), z.string()),
        value: z.tuple([z.number(), z.string()]),
      }),
    ),
  }),
});
type Metric = z.infer<typeof MetricsSchema>["data"]["result"][number];
type LoadSection<T> =
  { available: true; data: T } | { available: false; error: string };

async function section<T>(
  read: () => Promise<T>,
  secrets: readonly string[],
): Promise<LoadSection<T>> {
  try {
    return { available: true, data: await read() };
  } catch (error) {
    return {
      available: false,
      error: sanitizeText(
        error instanceof Error ? error.message : String(error),
        secrets,
      ),
    };
  }
}

async function metric(
  expression: string,
  signal?: AbortSignal,
): Promise<Metric[]> {
  const result = await captureJson(
    [
      "gcx",
      "--context",
      "homelab",
      "metrics",
      "query",
      expression,
      "-o",
      "json",
    ],
    MetricsSchema,
    signal,
  );
  if (result.data.result.length === 0)
    throw new Error("Prometheus returned no samples for CI load");
  for (const sample of result.data.result) {
    if (!Number.isFinite(Number(sample.value[1])))
      throw new TypeError("Prometheus returned a non-finite CI load sample");
    if (Date.now() / 1000 - sample.value[0] > 120)
      throw new Error("CI load telemetry is stale");
  }
  return result.data.result;
}

export async function ciLoad(config: WoodpeckerConfig, signal?: AbortSignal) {
  const secrets = [config.token];
  const [queue, admission, gateAdmission, cpu, memory, disk, ioPressure, pods] =
    await Promise.all([
      section(
        async () =>
          QueueSchema.parse(
            await woodpeckerJson("/api/queue/info", config, signal),
          ),
        secrets,
      ),
      section(
        () =>
          captureJson(
            ["kubectl", "get", "clusterqueue", "woodpecker", "-o", "json"],
            AdmissionSchema,
            signal,
          ),
        secrets,
      ),
      section(
        () =>
          captureJson(
            [
              "kubectl",
              "get",
              "clusterqueue",
              "woodpecker-gates",
              "-o",
              "json",
            ],
            AdmissionSchema,
            signal,
          ),
        secrets,
      ),
      section(
        () =>
          metric(
            '100 * (1 - avg(rate(node_cpu_seconds_total{node="liskov",mode="idle"}[5m])))',
            signal,
          ),
        secrets,
      ),
      section(
        () =>
          metric(
            '{__name__=~"node_memory_MemAvailable_bytes|node_memory_MemTotal_bytes",node="liskov"}',
            signal,
          ),
        secrets,
      ),
      section(
        () =>
          metric(
            '{__name__=~"node_filesystem_avail_bytes|node_filesystem_size_bytes",node="liskov",mountpoint="/var"}',
            signal,
          ),
        secrets,
      ),
      section(
        () =>
          metric(
            'rate(node_pressure_io_waiting_seconds_total{node="liskov"}[5m])',
            signal,
          ),
        secrets,
      ),
      section(() => ciPods(signal), secrets),
    ]);
  return {
    sampledAt: new Date().toISOString(),
    node: "liskov",
    queue,
    admission,
    gateAdmission,
    cpu,
    memory,
    disk,
    ioPressure,
    pods,
    guidance:
      "Queued work and long builds are expected. Keep the same ci wait process running. Load alone does not mean CI failed.",
  };
}

type LoadReport = Awaited<ReturnType<typeof ciLoad>>;

function formatAdmission(
  admission: LoadReport["admission"],
  queueName: string,
): string[] {
  if (!admission.available)
    return [`Kueue ${queueName} unavailable: ${admission.error}`];
  const data = admission.data;
  const lines = [
    `Kueue ${queueName}: ${String(data.status.pendingWorkloads)} pending, ${String(data.status.admittedWorkloads)} admitted`,
  ];
  const flavors = data.spec.resourceGroups.flatMap((group) => group.flavors);
  for (const flavor of flavors) {
    for (const resource of flavor.resources) {
      const used = data.status.flavorsReservation
        .find((item) => item.name === flavor.name)
        ?.resources.find((item) => item.name === resource.name);
      lines.push(
        `  ${resource.name}: ${used?.total ?? "unavailable"} reserved / ${resource.nominalQuota ?? "unavailable"} quota`,
      );
    }
  }
  return lines;
}

function formatMetric(name: string, value: LoadSection<Metric[]>): string[] {
  return value.available
    ? value.data.map(
        (sample) =>
          `${name}: ${sample.metric["__name__"] ?? "value"}=${sample.value[1]} (sample ${new Date(sample.value[0] * 1000).toISOString()})`,
      )
    : [`${name} unavailable: ${value.error}`];
}

export function formatLoad(report: LoadReport): string {
  const lines = [`CI load on ${report.node} at ${report.sampledAt}`];
  if (report.queue.available) {
    const stats = report.queue.data.stats;
    lines.push(
      `Woodpecker: ${String(stats.pending_count)} pending, ${String(stats.running_count)} running, ${String(stats.waiting_on_deps_count)} waiting on dependencies; ${String(stats.worker_count)} worker(s); paused=${String(report.queue.data.paused)}`,
    );
  } else lines.push(`Queue unavailable: ${report.queue.error}`);
  return [
    ...lines,
    ...formatAdmission(report.admission, "woodpecker"),
    ...formatAdmission(report.gateAdmission, "woodpecker-gates"),
    ...formatMetric("CPU percent", report.cpu),
    ...formatMetric("Memory bytes", report.memory),
    ...formatMetric("Disk bytes (/var)", report.disk),
    ...formatMetric("I/O waiting ratio", report.ioPressure),
    ...(report.pods.available
      ? report.pods.data.map(
          (pod) =>
            `  ${pod.pod} task=${pod.taskId ?? "unknown"} step=${pod.step ?? "unknown"}: ${pod.waitingReason ?? pod.phase}; age=${Math.round(pod.ageSeconds).toString()}s startup=${pod.startupSeconds === null ? "unknown" : `${Math.round(pod.startupSeconds).toString()}s`}`,
        )
      : [`Pod telemetry unavailable: ${report.pods.error}`]),
    report.guidance,
  ].join("\n");
}
