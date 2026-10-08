import type {
  AlertmanagerAlert,
  AlertmanagerSilence,
} from "@shepherdjerred/ops-clients/alertmanager.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import {
  worstSeverity,
  type Severity,
} from "@shepherdjerred/ops-model/severity.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import {
  ALERTMANAGER_URL,
  alertmanagerLink,
  externalLink,
  logsLink,
} from "./ops-links.ts";
import {
  metric,
  minutesSince,
  serviceForNamespace,
  truncate,
  type OpsCollection,
  type OpsContext,
} from "./ops-types.ts";

/** Alerts that fire by design (dead-man switches) and are never a problem. */
const ALWAYS_FIRING = new Set(["Watchdog", "InfoInhibitor"]);

const SEVERITY_BY_LABEL: Readonly<Record<string, Severity>> = {
  critical: "error",
  error: "error",
  warning: "warning",
  info: "info",
  none: "info",
};

/**
 * Alert severity labels are free-form upstream data. An unrecognized label
 * still surfaces as a warning so a mislabelled alert is never hidden.
 */
export function alertSeverity(alert: AlertmanagerAlert): Severity {
  const label = alert.labels["severity"];
  return label === undefined
    ? "warning"
    : (SEVERITY_BY_LABEL[label] ?? "warning");
}

/** Bounded workload identity; execution IDs deliberately do not group rows. */
function alertIdentity(alert: AlertmanagerAlert) {
  return {
    alertname: alert.labels["alertname"] ?? "(unnamed alert)",
    namespace: alert.labels["namespace"],
    temporalNamespace:
      alert.labels["temporalNamespace"] ??
      alert.labels["exported_namespace"] ??
      alert.labels["temporal_namespace"],
    workflowType: alert.labels["workflowType"] ?? alert.labels["workflow_type"],
    taskQueue:
      alert.labels["taskQueue"] ??
      alert.labels["task_queue"] ??
      alert.labels["taskqueue"],
    state: alert.status.state,
  };
}

function alertGroupId(alert: AlertmanagerAlert): string {
  const identity = alertIdentity(alert);
  const qualifiers = [
    identity.temporalNamespace,
    identity.workflowType,
    identity.taskQueue,
  ];
  const suffix = qualifiers.some((value) => value !== undefined)
    ? `:${qualifiers.map((value = "-") => encodeURIComponent(value)).join(":")}`
    : "";
  return `alerts:${identity.alertname}:${identity.namespace ?? "-"}${suffix}${identity.state === "active" ? "" : `:${identity.state}`}`;
}

/** Repeated executions share a row only within one workload and alert state. */
function alertGroupSignal(
  group: readonly AlertmanagerAlert[],
  context: OpsContext,
): SignalInput {
  const [first] = group;
  if (first === undefined) {
    throw new Error("alertGroupSignal requires at least one alert");
  }
  const {
    alertname,
    namespace,
    temporalNamespace,
    workflowType,
    taskQueue,
    state,
  } = alertIdentity(first);
  const severity = worstSeverity(group.map((alert) => alertSeverity(alert)));
  const since = group
    .map((alert) => alert.startsAt)
    .reduce((earliest, startsAt) =>
      Date.parse(startsAt) < Date.parse(earliest) ? startsAt : earliest,
    );
  const firingMinutes = minutesSince(since, context.now);
  const summaries = [
    ...new Set(group.map((alert) => alert.annotations["summary"] ?? alertname)),
  ].toSorted();
  const descriptions = [
    ...new Set(
      group
        .map((alert) => alert.annotations["description"])
        .filter((value) => value !== undefined),
    ),
  ].toSorted();
  const title =
    summaries.length === 1
      ? (summaries[0] ?? alertname)
      : `${alertname}${workflowType === undefined ? "" : `: ${workflowType}`}`;
  const description =
    descriptions.length <= 1
      ? descriptions[0]
      : `${String(descriptions.length)} distinct causes. Examples: ${descriptions.slice(0, 3).join("; ")}`;
  return {
    id: alertGroupId(first),
    source: "alerts",
    section: "alerts",
    ...serviceForNamespace(context, namespace),
    kind: "alert",
    severity,
    needsMe:
      state === "active" &&
      (severity === "error" || severity === "warning") &&
      firingMinutes >= OPS_POLICY.alertNeedsMeAfterMinutes,
    title: truncate(
      group.length === 1 ? title : `${title} (×${String(group.length)})`,
      200,
    ),
    ...(description === undefined
      ? {}
      : { detail: truncate(description, 500) }),
    since: new Date(Date.parse(since)).toISOString(),
    attributes: {
      alertname,
      count: group.length,
      firingMinutes: Math.round(firingMinutes),
      ...(namespace === undefined ? {} : { namespace }),
      ...(temporalNamespace === undefined ? {} : { temporalNamespace }),
      ...(workflowType === undefined ? {} : { workflowType }),
      ...(taskQueue === undefined ? {} : { taskQueue }),
      state,
      distinctCauses: descriptions.length,
    },
    links: [
      alertmanagerLink(alertname),
      ...externalLink("native", "Runbook", first.annotations["runbook_url"]),
      ...(namespace === undefined ? [] : [logsLink(namespace)]),
    ],
  };
}

function groupAlerts(
  alerts: readonly AlertmanagerAlert[],
): AlertmanagerAlert[][] {
  const groups = new Map<string, AlertmanagerAlert[]>();
  for (const alert of alerts) {
    const key = JSON.stringify(alertIdentity(alert));
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [alert]);
    } else {
      group.push(alert);
    }
  }
  return [...groups.values()];
}

export function mapAlerts(
  alerts: readonly AlertmanagerAlert[],
  silences: readonly AlertmanagerSilence[],
  context: OpsContext,
): OpsCollection {
  const firing = alerts.filter(
    (alert) => !ALWAYS_FIRING.has(alert.labels["alertname"] ?? ""),
  );
  const signals = groupAlerts(firing).map((group) =>
    alertGroupSignal(group, context),
  );
  if (silences.length > 0) {
    signals.push({
      id: "alerts:silences",
      source: "alerts",
      section: "alerts",
      kind: "silences",
      severity: "info",
      needsMe: false,
      title: `${String(silences.length)} active silence${silences.length === 1 ? "" : "s"}`,
      detail: truncate(
        silences
          .map((silence) => `${silence.comment} (until ${silence.endsAt})`)
          .join("; "),
        500,
      ),
      links: [
        {
          kind: "native",
          label: "Silences",
          url: `${ALERTMANAGER_URL}/#/silences`,
        },
      ],
    });
  }
  const bySeverity = (severity: Severity) =>
    firing.filter((alert) => alertSeverity(alert) === severity).length;
  const critical = bySeverity("error");
  const warning = bySeverity("warning");
  return {
    signals,
    metrics: [
      metric({
        section: "alerts",
        source: "alerts",
        id: METRIC_IDS.alertsFiring,
        label: "Firing alerts",
        value: firing.length,
        unit: "count",
      }),
      metric({
        section: "alerts",
        source: "alerts",
        id: METRIC_IDS.alertsCritical,
        label: "Critical",
        value: critical,
        unit: "count",
        severity: critical > 0 ? "error" : "ok",
      }),
      metric({
        section: "alerts",
        source: "alerts",
        id: METRIC_IDS.alertsWarning,
        label: "Warning",
        value: warning,
        unit: "count",
        severity: warning > 0 ? "warning" : "ok",
      }),
    ],
    // The dashboard derives alert-open/resolve timeline entries from its own
    // Alertmanager webhook ledger; emitting them here would duplicate them.
    changes: [],
  };
}
