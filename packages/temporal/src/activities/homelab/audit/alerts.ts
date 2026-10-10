import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { ReportEnvelopeV1 } from "#shared/reports/report.ts";

type Finding = ReportEnvelopeV1["findings"][number];

export const AuditAlertOccurrenceSchema = z.object({
  id: z.string(),
  alertname: z.string(),
  namespace: z.string().nullable(),
  severity: z.enum(["critical", "warning", "info", "unknown"]),
  summary: z.string(),
  lifecycleState: z.literal("open"),
  suppressionState: z.enum(["none", "silenced", "inhibited", "unprocessed"]),
  labels: z.record(z.string(), z.string()),
});

const PrometheusAlertSchema = z.object({
  metric: z
    .object({
      alertname: z.string(),
      severity: z.string().optional(),
    })
    .catchall(z.string()),
});

function alertIdentity(labels: Record<string, string>): string {
  // Alertmanager adds HA routing labels; ALERTS adds its series metadata.
  // Keep all condition labels, including pod/workload/instance, so distinct
  // causes are never merged merely because their alert names match.
  const ignored = new Set([
    "__name__",
    "alertstate",
    "prometheus",
    "prometheus_replica",
  ]);
  const identity = Object.entries(labels)
    .filter(([key]) => !ignored.has(key))
    .toSorted(([left], [right]) => left.localeCompare(right));
  return `alert:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

function severity(
  value: string | undefined,
  alertname: string,
): Finding["severity"] {
  if (alertname === "Watchdog" || alertname === "InfoInhibitor") return "info";
  if (value === "critical" || value === "error") return "critical";
  return value === "info" || value === "none" ? "info" : "warning";
}

export function interpretPrometheusAlerts(result: readonly unknown[]): {
  summary: string;
  findings: Finding[];
} {
  const alerts = z.array(PrometheusAlertSchema).parse(result);
  return {
    summary: `${alerts.length.toString()} firing series (severity preserved)`,
    findings: alerts.map(({ metric }) => ({
      id: alertIdentity(metric),
      state: "active",
      severity: severity(metric.severity, metric.alertname),
      summary: `${metric.alertname}: firing`,
      detail: JSON.stringify(metric),
      evidenceReceiptIds: [],
    })),
  };
}

export function interpretAlertOccurrences(
  alerts: z.infer<typeof AuditAlertOccurrenceSchema>[],
): {
  summary: string;
  findings: Finding[];
} {
  const suppressed = alerts.filter(
    (alert) =>
      alert.suppressionState === "silenced" ||
      alert.suppressionState === "inhibited",
  ).length;
  return {
    summary: `${alerts.length.toString()} open occurrences; ${suppressed.toString()} suppressed`,
    findings: alerts.map((alert) => {
      const isSuppressed =
        alert.suppressionState === "silenced" ||
        alert.suppressionState === "inhibited";
      return {
        id: alertIdentity(alert.labels),
        state: isSuppressed ? "suppressed" : "active",
        severity: isSuppressed
          ? "info"
          : severity(alert.severity, alert.alertname),
        summary: `${alert.alertname}: ${alert.summary}`,
        detail: `id=${alert.id}; namespace=${alert.namespace ?? "none"}; sourceSeverity=${alert.severity}; suppression=${alert.suppressionState}`,
        evidenceReceiptIds: [],
      };
    }),
  };
}

/** Ledger findings follow Prometheus and supply the authoritative suppression state. */
export function deduplicateAuditFindings(findings: Finding[]): Finding[] {
  const unique = new Map<string, Finding>();
  const unkeyed: Finding[] = [];
  for (const finding of findings) {
    if (finding.id === undefined) {
      unkeyed.push(finding);
      continue;
    }
    const previous = unique.get(finding.id);
    unique.set(finding.id, {
      ...finding,
      evidenceReceiptIds: [
        ...new Set([
          ...(previous?.evidenceReceiptIds ?? []),
          ...finding.evidenceReceiptIds,
        ]),
      ],
    });
  }
  return [...unique.values(), ...unkeyed];
}
