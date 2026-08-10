import type { AppConfig } from "../config.ts";
import { AlertsClient } from "../clients/alerts.ts";
import { BugsinkClient } from "../clients/bugsink.ts";
import { KubernetesClient } from "../clients/kubernetes.ts";
import { PrometheusClient } from "../clients/prometheus.ts";
import { statusFromCount, worstStatus, type Status } from "../status.ts";
import { formatDisplayTime } from "../time.ts";
import type {
  AlertsSection,
  BugsinkSection,
  HardwareSection,
  HomelabPayload,
  KubernetesSection,
  StorageSection,
} from "../types.ts";

type PrometheusQuerier = Pick<PrometheusClient, "query" | "scalar">;
type AlertsReader = Pick<AlertsClient, "getSummary" | "listOpen">;

export type HomelabClients = {
  prometheus: PrometheusQuerier;
  alerts: AlertsReader;
  kubernetes: Pick<KubernetesClient, "getSummary">;
  bugsink?: Pick<BugsinkClient, "getProjectSummaries">;
};

export function createHomelabClients(config: AppConfig): HomelabClients {
  return {
    prometheus: new PrometheusClient(config.homelab.prometheusUrl),
    alerts: new AlertsClient(config.homelab.alertDashboardUrl),
    kubernetes: new KubernetesClient(
      config.homelab.kubernetesUrl,
      config.homelab.kubernetesTokenPath,
      config.homelab.kubernetesCaPath,
    ),
    ...(config.homelab.bugsinkToken == null
      ? {}
      : {
          bugsink: new BugsinkClient(
            config.homelab.bugsinkUrl,
            config.homelab.bugsinkToken,
          ),
        }),
  };
}

export async function collectHomelabPayload(
  config: AppConfig,
  clients = createHomelabClients(config),
): Promise<HomelabPayload> {
  const errors: string[] = [];
  const [bugsink, kubernetes, storage, hardware, alerts] = await Promise.all([
    collectBugsink(clients, errors),
    collectKubernetes(clients, errors),
    collectStorage(clients.prometheus, errors),
    collectHardware(clients.prometheus, errors),
    collectAlerts(clients.alerts, errors),
  ]);

  const status = worstStatus([
    bugsink.status,
    alerts.status,
    kubernetes.status,
    storage.status,
    hardware.status,
    alerts.status,
    errors.length > 0 ? "unknown" : "ok",
  ]);
  const generatedAt = new Date();

  return {
    screen: "homelab",
    generated_at: generatedAt.toISOString(),
    generated_time: formatDisplayTime(generatedAt, config.displayTimeZone),
    status,
    summary: [
      `${kubernetes.ready_nodes.toString()}/${kubernetes.total_nodes.toString()} nodes`,
      `${alerts.critical.toString()} critical alerts`,
      `${alerts.warning.toString()} warning alerts`,
      bugsink.status === "unknown"
        ? "Bugsink ERR"
        : `${bugsink.unresolved.toString()} Bugsink`,
      alerts.status === "unknown"
        ? "Alerts ERR"
        : `${alerts.open.toString()} open alerts`,
    ].join(" · "),
    bugsink,
    kubernetes,
    storage,
    hardware,
    alerts,
    errors,
  };
}

async function collectBugsink(
  clients: HomelabClients,
  errors: string[],
): Promise<BugsinkSection> {
  if (clients.bugsink == null) {
    return { status: "unknown", unresolved: 0, projects: [] };
  }
  try {
    const projects = await clients.bugsink.getProjectSummaries();
    const unresolved = projects.reduce(
      (total, project) => total + project.unresolved,
      0,
    );
    return {
      status: statusFromCount(unresolved, 1, 20),
      unresolved,
      projects: projects
        .filter((project) => project.unresolved > 0)
        .slice(0, 6),
    };
  } catch (error) {
    errors.push(errorMessage("Bugsink", error));
    return { status: "unknown", unresolved: 0, projects: [] };
  }
}

async function collectKubernetes(
  clients: HomelabClients,
  errors: string[],
): Promise<KubernetesSection> {
  try {
    const summary = await clients.kubernetes.getSummary();
    return {
      status:
        summary.readyNodes < summary.totalNodes
          ? "error"
          : summary.unhealthyPods > 0
            ? "warning"
            : "ok",
      ready_nodes: summary.readyNodes,
      total_nodes: summary.totalNodes,
      unhealthy_pods: summary.unhealthyPods,
    };
  } catch (error) {
    errors.push(errorMessage("Kubernetes", error));
    return {
      status: "unknown",
      ready_nodes: 0,
      total_nodes: 0,
      unhealthy_pods: 0,
    };
  }
}

async function collectStorage(
  prometheus: PrometheusQuerier,
  errors: string[],
): Promise<StorageSection> {
  try {
    const samples = await prometheus.query(
      '100 * (1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"})',
    );
    const volumes = samples
      .map((sample) => ({
        name: sample.metric["mountpoint"] ?? sample.metric["device"] ?? "disk",
        used_percent: round(sample.value),
      }))
      .filter((volume) => isRelevantStorageVolume(volume.name))
      .filter((volume) => Number.isFinite(volume.used_percent))
      .toSorted((a, b) => b.used_percent - a.used_percent)
      .slice(0, 6);
    const max = volumes[0]?.used_percent ?? null;
    return {
      status: statusFromOptionalPercent(max, 80, 90),
      max_disk_used_percent: max,
      volumes,
    };
  } catch (error) {
    errors.push(errorMessage("storage metrics", error));
    return { status: "unknown", max_disk_used_percent: null, volumes: [] };
  }
}

function isRelevantStorageVolume(name: string): boolean {
  return !["/etc/extensions.yaml", "/usr/lib/firmware"].includes(name);
}

async function collectHardware(
  prometheus: PrometheusQuerier,
  errors: string[],
): Promise<HardwareSection> {
  try {
    const [cpu, memory] = await Promise.all([
      prometheus.scalar(
        '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])))',
      ),
      prometheus.scalar(
        "100 * (1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes))",
      ),
    ]);
    const cpuPercent = cpu == null ? null : round(cpu);
    const memoryPercent = memory == null ? null : round(memory);
    return {
      status: worstStatus([
        statusFromOptionalPercent(cpuPercent, 80, 95),
        statusFromOptionalPercent(memoryPercent, 85, 95),
      ]),
      cpu_used_percent: cpuPercent,
      memory_used_percent: memoryPercent,
    };
  } catch (error) {
    errors.push(errorMessage("hardware metrics", error));
    return {
      status: "unknown",
      cpu_used_percent: null,
      memory_used_percent: null,
    };
  }
}

async function collectAlerts(
  alerts: AlertsReader,
  errors: string[],
): Promise<AlertsSection> {
  try {
    const [summary, openAlerts] = await Promise.all([
      alerts.getSummary(),
      alerts.listOpen(),
    ]);
    return {
      status:
        summary.critical > 0 ? "error" : summary.warning > 0 ? "warning" : "ok",
      open: summary.open,
      critical: summary.critical,
      warning: summary.warning,
      info: summary.info,
      recent: openAlerts.map((alert) => ({
        severity: alert.severity,
        alertname: alert.alertname,
        summary: alert.summary,
      })),
    };
  } catch (error) {
    errors.push(errorMessage("Alerts", error));
    return {
      status: "unknown",
      open: 0,
      critical: 0,
      warning: 0,
      info: 0,
      recent: [],
    };
  }
}

function statusFromOptionalPercent(
  value: number | null,
  warning: number,
  error: number,
): Status {
  if (value == null) {
    return "unknown";
  }
  return value >= error ? "error" : value >= warning ? "warning" : "ok";
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function errorMessage(area: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${area}: ${message}`;
}
