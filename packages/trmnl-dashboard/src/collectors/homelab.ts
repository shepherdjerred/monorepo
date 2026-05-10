import type { AppConfig } from "../config.ts";
import { AlertmanagerClient } from "../clients/alertmanager.ts";
import { BugsinkClient } from "../clients/bugsink.ts";
import { KubernetesClient } from "../clients/kubernetes.ts";
import { PagerDutyClient } from "../clients/pagerduty.ts";
import { PrometheusClient } from "../clients/prometheus.ts";
import { statusFromCount, worstStatus, type Status } from "../status.ts";
import type {
  AlertsSection,
  BugsinkSection,
  HardwareSection,
  HomelabPayload,
  KubernetesSection,
  PagerDutySection,
  StorageSection,
} from "../types.ts";

type PrometheusQuerier = Pick<PrometheusClient, "query" | "scalar">;
type AlertmanagerReader = Pick<AlertmanagerClient, "getActiveAlerts">;

export type HomelabClients = {
  prometheus: PrometheusQuerier;
  alertmanager: AlertmanagerReader;
  kubernetes: Pick<KubernetesClient, "getSummary">;
  bugsink?: Pick<BugsinkClient, "getProjectSummaries">;
  pagerDuty?: Pick<PagerDutyClient, "getSummary">;
};

export function createHomelabClients(config: AppConfig): HomelabClients {
  return {
    prometheus: new PrometheusClient(config.homelab.prometheusUrl),
    alertmanager: new AlertmanagerClient(config.homelab.alertmanagerUrl),
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
    ...(config.homelab.pagerDutyToken == null
      ? {}
      : { pagerDuty: new PagerDutyClient(config.homelab.pagerDutyToken) }),
  };
}

export async function collectHomelabPayload(
  config: AppConfig,
  clients = createHomelabClients(config),
): Promise<HomelabPayload> {
  const errors: string[] = [];
  const [bugsink, pagerduty, kubernetes, storage, hardware, alerts] =
    await Promise.all([
      collectBugsink(clients, errors),
      collectPagerDuty(clients, errors),
      collectKubernetes(clients, errors),
      collectStorage(clients.prometheus, errors),
      collectHardware(clients.prometheus, errors),
      collectAlerts(clients.alertmanager, errors),
    ]);

  const status = worstStatus([
    bugsink.status,
    pagerduty.status,
    kubernetes.status,
    storage.status,
    hardware.status,
    alerts.status,
    errors.length > 0 ? "unknown" : "ok",
  ]);

  return {
    screen: "homelab",
    generated_at: new Date().toISOString(),
    status,
    summary: [
      `${kubernetes.ready_nodes.toString()}/${kubernetes.total_nodes.toString()} nodes`,
      `${alerts.critical.toString()} critical alerts`,
      `${bugsink.unresolved.toString()} Bugsink`,
      `${pagerduty.triggered.toString()} PD`,
    ].join(" · "),
    bugsink,
    pagerduty,
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

async function collectPagerDuty(
  clients: HomelabClients,
  errors: string[],
): Promise<PagerDutySection> {
  if (clients.pagerDuty == null) {
    return { status: "unknown", triggered: 0, acknowledged: 0, on_call: [] };
  }
  try {
    const summary = await clients.pagerDuty.getSummary();
    return {
      status:
        summary.triggered > 0
          ? "error"
          : summary.acknowledged > 0
            ? "warning"
            : "ok",
      triggered: summary.triggered,
      acknowledged: summary.acknowledged,
      on_call: summary.onCall,
    };
  } catch (error) {
    errors.push(errorMessage("PagerDuty", error));
    return { status: "unknown", triggered: 0, acknowledged: 0, on_call: [] };
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
  alertmanager: AlertmanagerReader,
  errors: string[],
): Promise<AlertsSection> {
  try {
    const active = await alertmanager.getActiveAlerts();
    const critical = active.filter(
      (alert) =>
        alert.status.state === "active" &&
        alert.labels["severity"] === "critical",
    ).length;
    const warning = active.filter(
      (alert) =>
        alert.status.state === "active" &&
        alert.labels["severity"] !== "critical",
    ).length;
    return {
      status: critical > 0 ? "error" : warning > 0 ? "warning" : "ok",
      critical,
      warning,
    };
  } catch (error) {
    errors.push(errorMessage("Alertmanager", error));
    return { status: "unknown", critical: 0, warning: 0 };
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
