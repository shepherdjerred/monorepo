import type {
  AlertmanagerAlert,
  AlertmanagerSilence,
} from "@shepherdjerred/ops-clients/alertmanager.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
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

function alertSignal(
  alert: AlertmanagerAlert,
  context: OpsContext,
): SignalInput {
  const alertname = alert.labels["alertname"] ?? "(unnamed alert)";
  const namespace = alert.labels["namespace"];
  const severity = alertSeverity(alert);
  const firingMinutes = minutesSince(alert.startsAt, context.now);
  const summary = alert.annotations["summary"];
  const description = alert.annotations["description"];
  return {
    id: `alerts:${alert.fingerprint}`,
    source: "alerts",
    section: "alerts",
    ...serviceForNamespace(context, namespace),
    kind: "alert",
    severity,
    needsMe:
      (severity === "error" || severity === "warning") &&
      firingMinutes >= OPS_POLICY.alertNeedsMeAfterMinutes,
    title: truncate(summary ?? alertname, 200),
    ...(description === undefined
      ? {}
      : { detail: truncate(description, 500) }),
    since: new Date(Date.parse(alert.startsAt)).toISOString(),
    attributes: {
      alertname,
      firingMinutes: Math.round(firingMinutes),
      ...(namespace === undefined ? {} : { namespace }),
    },
    links: [
      alertmanagerLink(alertname),
      ...externalLink("native", "Runbook", alert.annotations["runbook_url"]),
      ...(namespace === undefined ? [] : [logsLink(namespace)]),
    ],
  };
}

export function mapAlerts(
  alerts: readonly AlertmanagerAlert[],
  silences: readonly AlertmanagerSilence[],
  context: OpsContext,
): OpsCollection {
  const firing = alerts.filter(
    (alert) => !ALWAYS_FIRING.has(alert.labels["alertname"] ?? ""),
  );
  const signals = firing.map((alert) => alertSignal(alert, context));
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
