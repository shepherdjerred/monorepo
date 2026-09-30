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

/**
 * One signal per alert name and namespace. Alertmanager fires one alert per
 * label set (e.g. one per failed workflow execution), which would otherwise
 * flood the overview with near-identical rows.
 */
function alertGroupSignal(
  group: readonly AlertmanagerAlert[],
  context: OpsContext,
): SignalInput {
  const [first] = group;
  if (first === undefined) {
    throw new Error("alertGroupSignal requires at least one alert");
  }
  const alertname = first.labels["alertname"] ?? "(unnamed alert)";
  const namespace = first.labels["namespace"];
  const severity = worstSeverity(group.map((alert) => alertSeverity(alert)));
  const since = group
    .map((alert) => alert.startsAt)
    .reduce((earliest, startsAt) =>
      Date.parse(startsAt) < Date.parse(earliest) ? startsAt : earliest,
    );
  const firingMinutes = minutesSince(since, context.now);
  const summary = first.annotations["summary"];
  const description = first.annotations["description"];
  const title = summary ?? alertname;
  return {
    id: `alerts:${alertname}:${namespace ?? "-"}`,
    source: "alerts",
    section: "alerts",
    ...serviceForNamespace(context, namespace),
    kind: "alert",
    severity,
    needsMe:
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
    const key = `${alert.labels["alertname"] ?? ""}\u{0}${alert.labels["namespace"] ?? ""}`;
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
