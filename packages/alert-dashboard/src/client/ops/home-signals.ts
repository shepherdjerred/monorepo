import type { Section, Signal } from "@shepherdjerred/ops-model/snapshot.ts";

/**
 * The alert groups behind the firing count. Selecting by kind rather than by
 * severity keeps informational alerts, which the count includes, and leaves
 * out the section's other signals, such as the active-silences summary.
 */
export function firingAlertSignals(alerts: Section): Signal[] {
  return alerts.signals.filter((signal) => signal.kind === "alert");
}
