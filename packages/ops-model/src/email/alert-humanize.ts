import type {
  ServiceIndex,
  Service,
} from "@shepherdjerred/ops-model/catalog.ts";
import { formatPacificTimestamp, type EmailDetailRow } from "./primitives.ts";

export type AlertMetadataInput = {
  alertname: string;
  namespace: string | null;
  openedAtIso?: string;
  labels: Readonly<Record<string, string>>;
};

/** Specific everyday workload names for multi-tenant catalog buckets. */
const SPECIFIC_APP_TITLES: Readonly<Record<string, string>> = {
  golink: "Golink",
  freshrss: "FreshRSS",
  redlib: "Redlib",
  stash: "Stash",
  syncthing: "Syncthing",
  pinchtab: "PinchTab",
  streambot: "Streambot",
  media: "Media",
  argocd: "Argo CD",
  charts: "Charts",
  velero: "Velero",
  seaweedfs: "SeaweedFS",
  openebs: "ZFS Storage",
  "postgres-operator": "PostgreSQL",
  woodpecker: "Woodpecker CI",
  "woodpecker-ci": "Woodpecker CI",
  buildkitd: "BuildKit",
  "ci-cache": "CI Cache",
  "kueue-system": "CI Queue",
  tailscale: "Tailscale",
  "cloudflare-tunnel": "Cloudflare Tunnel",
  "cert-manager": "TLS Certificates",
  flags: "Feature Flags",
  "1password": "1Password Connect",
  mail: "Mail",
  prometheus: "Prometheus",
  loki: "Loki",
  tempo: "Tempo",
  grafana: "Grafana",
  alloy: "Grafana Alloy",
  "scout-prod": "Scout",
  "scout-beta": "Scout (Beta)",
};

/** Plain-English fallbacks for upstream kube-prometheus-stack alert rules. */
const UPSTREAM_RULE_HEADLINES: Readonly<Record<string, string>> = {
  KubePodCrashLooping: "Pod is restarting repeatedly",
  KubePodNotReady: "Pod has been unready for over 15 minutes",
  KubeDeploymentGenerationMismatch: "Deployment rollout is stalled",
  KubeDeploymentReplicasMismatch: "Deployment is missing healthy pods",
  KubeStatefulSetReplicasMismatch: "StatefulSet is missing healthy pods",
  KubeDaemonSetRolloutStuck: "Node agent rollout is stuck",
  KubeContainerWaiting: "Container has been waiting to start for over an hour",
  KubeJobFailed: "Background job failed",
  KubePersistentVolumeFillingUp: "Storage volume is running low on space",
  KubePersistentVolumeInodesFillingUp:
    "Storage volume is running out of inodes",
  KubeNodeNotReady: "Cluster node is not ready",
  KubeNodeUnreachable: "Cluster node is unreachable",
  KubeMemoryQuotaOvercommit: "Namespace memory quota is overcommitted",
  TargetDown: "Metrics endpoint is unreachable",
  AlertmanagerFailedToSendAlerts:
    "Alertmanager could not deliver notifications",
  AlertmanagerClusterFailedToSendAlerts:
    "Alertmanager cannot deliver notifications",
  PrometheusNotConnectedToAlertmanagers:
    "Prometheus lost connection to Alertmanager",
  PrometheusRuleFailures: "Prometheus alert rule evaluation failed",
  NodeFilesystemAlmostOutOfSpace: "Node disk is almost full",
  NodeFilesystemSpaceFillingUp: "Node disk is filling up quickly",
  NodeClockNotSynchronising: "Node system clock is out of sync",
};

const CONTEXT_LABEL_SPEC: readonly {
  keys: readonly string[];
  label: string;
}[] = [
  { keys: ["workflow_type", "workflowType", "workflow"], label: "Workflow" },
  { keys: ["activityType", "activity_type"], label: "Activity" },
  { keys: ["task_queue", "taskqueue"], label: "Queue" },
  { keys: ["schedule_id", "schedule"], label: "Schedule" },
  { keys: ["name", "application"], label: "App" },
  { keys: ["zpool_name", "pool"], label: "Pool" },
  { keys: ["dataset"], label: "Dataset" },
  { keys: ["device_model", "model", "device", "disk"], label: "Drive" },
  { keys: ["serial_number", "serial"], label: "Serial" },
  { keys: ["persistentvolumeclaim", "pvc"], label: "Volume" },
  { keys: ["site"], label: "Site" },
  { keys: ["node", "node_name"], label: "Node" },
  { keys: ["pod"], label: "Pod" },
];

const ACTION_LEAD_RE =
  /^(?:Next step:\s*|Check\b|Inspect\b|Pause\b|Verify\b|Run\b|Clear\b|Open\b|Restart\b|Review\b|Prune\b|Re-authenticate\b|Enable\b|Merge\b|Scale\b|Investigate\b|Replace\b|Confirm\b|Delete\b|Expand\b|Drain\b|Roll\b|Restore\b)/iu;

function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeRuleName(alertname: string): string {
  const spaced = alertname
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .trim();
  return spaced.length === 0
    ? alertname
    : spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function stripLeadingServicePrefix(
  text: string,
  serviceLabel?: string,
): string {
  if (serviceLabel === undefined || serviceLabel.length === 0) return text;
  const escaped = serviceLabel.replaceAll(
    /[.*+?^${}()|[\]\\]/gu,
    String.raw`\$&`,
  );
  const prefixRe = new RegExp(String.raw`^${escaped}(?:\s*[:—-]\s*|\s+)`, "iu");
  const stripped = text.replace(prefixRe, "").trim();
  return stripped.length >= 10
    ? stripped.charAt(0).toUpperCase() + stripped.slice(1)
    : text;
}

/**
 * Produce a clean, human-readable alert headline free of bracket tags, pod
 * hashes, IP:port scrape targets, or redundant leading service names.
 */
export function cleanAlertSummary(
  summary: string,
  alertname: string,
  serviceLabel?: string,
): string {
  const upstreamOverride = UPSTREAM_RULE_HEADLINES[alertname];
  if (upstreamOverride !== undefined) return upstreamOverride;

  const base = summary
    .trim()
    .replace(/^\[[^\]]+\]\s*/u, "")
    .replaceAll(/\s+on\s+\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/gu, "")
    .replaceAll(/\b[a-z0-9-]+-[0-9a-f]{8,10}-[a-z0-9]{5}\b/gu, "pod")
    .replaceAll(/\s{2,}/gu, " ")
    .trim();

  const cleaned = stripLeadingServicePrefix(base, serviceLabel);
  return cleaned === "" || cleaned === alertname
    ? humanizeRuleName(alertname)
    : cleaned;
}

export function resolveAlertService(
  alert: Pick<AlertMetadataInput, "namespace" | "labels">,
  services: ServiceIndex,
): { service: Service | undefined; serviceLabel: string } {
  const candidates = [
    alert.namespace === null
      ? undefined
      : services.byNamespace(alert.namespace),
    alert.labels["app"] === undefined
      ? undefined
      : services.byId(alert.labels["app"]),
    alert.labels["name"] === undefined
      ? undefined
      : services.byArgoApp(alert.labels["name"]),
  ];
  const matched = candidates.find((entry) => entry !== undefined);
  const specificKey = [
    alert.labels["app"],
    alert.namespace ?? undefined,
    alert.labels["name"],
  ].find((key) => key !== undefined && SPECIFIC_APP_TITLES[key] !== undefined);
  const specificTitle =
    specificKey === undefined ? undefined : SPECIFIC_APP_TITLES[specificKey];

  if (matched !== undefined) {
    return {
      service: matched,
      serviceLabel: specificTitle ?? matched.title,
    };
  }
  const fallbackSlug =
    alert.namespace ?? alert.labels["app"] ?? alert.labels["job"];
  return {
    service: undefined,
    serviceLabel:
      specificTitle ??
      (fallbackSlug === undefined ? "Cluster" : humanizeSlug(fallbackSlug)),
  };
}

/**
 * Split an alert annotation into a plain symptom/impact sentence and a distinct
 * `Next step` line when the final sentence gives an operator action.
 */
export function splitAlertExplanation(
  annotations: Readonly<Record<string, string>>,
  summary: string,
): { impact?: string; nextStep?: string } {
  const raw = (
    annotations["description"] ??
    annotations["message"] ??
    ""
  ).trim();
  if (raw.length === 0 || raw === summary.trim()) return {};

  const sentences = raw
    .split(/(?<=[.!?])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const last = sentences.at(-1) ?? "";
  const isActionLead = sentences.length >= 2 && ACTION_LEAD_RE.test(last);
  if (isActionLead) {
    return {
      impact: sentences.slice(0, -1).join(" "),
      nextStep: last.replace(/^Next step:\s*/iu, ""),
    };
  }
  return /^Next step:\s*/iu.test(raw)
    ? { nextStep: raw.replace(/^Next step:\s*/iu, "") }
    : { impact: raw };
}

function extractLabelRows(
  labels: Readonly<Record<string, string>>,
  includePod: boolean,
): EmailDetailRow[] {
  const rows: EmailDetailRow[] = [];
  const seen = new Set<string>();
  for (const spec of CONTEXT_LABEL_SPEC) {
    if (!includePod && spec.label === "Pod") continue;
    const matchedKey = spec.keys.find((key) => (labels[key] ?? "").length > 0);
    if (matchedKey !== undefined && !seen.has(spec.label)) {
      seen.add(spec.label);
      rows.push({
        label: spec.label,
        value: labels[matchedKey] ?? "",
        mono: true,
      });
    }
  }
  return rows;
}

export function extractAlertDetails(
  alert: AlertMetadataInput,
  options: {
    targets?: readonly string[];
    hubAlertsUrl?: string;
    includeRule?: boolean;
  } = {},
): EmailDetailRow[] {
  const includePod = (options.targets?.length ?? 0) === 0;
  const rows = extractLabelRows(alert.labels, includePod);
  if (options.targets !== undefined && options.targets.length > 0) {
    rows.push({
      label: `Instances (${String(options.targets.length)})`,
      value: options.targets.join(", "),
      mono: true,
    });
  }
  if (alert.openedAtIso !== undefined) {
    rows.push({
      label: "Started",
      value: formatPacificTimestamp(alert.openedAtIso),
      mono: false,
    });
  }
  if (options.includeRule ?? true) {
    const nsSuffix = alert.namespace === null ? "" : ` (${alert.namespace})`;
    rows.push({
      label: "Alert rule",
      value: `${alert.alertname}${nsSuffix}`,
      mono: true,
    });
  }
  if (options.hubAlertsUrl !== undefined) {
    rows.push({
      label: "All alerts",
      value: "Open Hub Alerts",
      url: options.hubAlertsUrl,
      mono: false,
    });
  }
  return rows;
}
