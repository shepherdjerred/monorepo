import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";

export type ScoutMonitorDrill = "beta" | "prod";

/**
 * The Scout environment whose Delivery monitor the cutover window drills, or
 * null when no drill runs. It is committed source so the window turns it on
 * and off by reviewed changes, never by hand: `beta` (the monitor alarms and
 * holds), then `prod` (the monitor alarms and rolls back to the last settled
 * selection), then null again.
 */
export function scoutMonitorDrill(): ScoutMonitorDrill | null {
  return null;
}

export const SCOUT_MONITOR_DRILL_ALERT = "ScoutMonitorDrill";

/**
 * An alert that always fires for the drilled environment. Its name and labels
 * match that environment's Scout monitor (`alertname=~Scout.*`,
 * `environment=<env>`, severity `warning`), so the monitor sees a firing alarm
 * without any real fault.
 */
export function getScoutMonitorDrillRuleGroups(
  drill: ScoutMonitorDrill | null = scoutMonitorDrill(),
): PrometheusRuleSpecGroups[] {
  if (drill === null) return [];
  return [
    {
      name: "scout-monitor-drill",
      rules: [
        {
          alert: SCOUT_MONITOR_DRILL_ALERT,
          annotations: {
            summary: `Delivery monitor drill for Scout ${drill}`,
            message: `A cutover drill: the Scout ${drill} monitor should report this alarm (beta holds, prod rolls back). Turn the drill off with a reviewed change once observed.`,
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString("vector(1)"),
          labels: { environment: drill, severity: "warning" },
        },
      ],
    },
  ];
}
