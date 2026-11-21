import { worstSeverity } from "@shepherdjerred/ops-model/severity.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type { Section, Signal } from "@shepherdjerred/ops-model/snapshot.ts";

/**
 * The alert groups behind the firing count. Selecting by kind rather than by
 * severity keeps informational alerts, which the count includes, and leaves
 * out the section's other signals, such as the active-silences summary.
 */
export function firingAlertSignals(alerts: Section): Signal[] {
  return alerts.signals.filter((signal) => signal.kind === "alert");
}

/**
 * The line under the firing-alerts tile. The tile counts individual alerts
 * and the list beside it shows alert groups, so the hint states the group
 * count to tie the two numbers together.
 */
export function firingAlertsHint(groups: number, critical: string): string {
  return `in ${String(groups)} group${groups === 1 ? "" : "s"} · ${critical} critical`;
}

/**
 * How bad the firing-alerts tile is: the worst of the count metric's own
 * severity and the alerts that are firing. The count alone is not enough,
 * because a collector that reports it as `ok` would paint a critical alert
 * green. Nothing firing is `ok`.
 */
export function firingAlertsSeverity(
  metricSeverity: Severity,
  alerts: Section,
): Severity {
  return worstSeverity([
    metricSeverity,
    ...firingAlertSignals(alerts).map((signal) => signal.severity),
  ]);
}

/**
 * How bad the waiting-on-you tile is: the worst signal that waits, so a
 * hundred informational approvals read as information and one failed restore
 * reads as a warning. Nothing waiting is `ok`.
 */
export function waitingSeverity(needsMe: readonly Signal[]): Severity {
  return worstSeverity(needsMe.map((signal) => signal.severity));
}
