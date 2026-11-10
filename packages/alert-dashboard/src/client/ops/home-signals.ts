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
