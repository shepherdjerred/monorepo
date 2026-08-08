import type { AlertService } from "#application/alert-service";
import type { ChangeBus } from "#server/change-bus";
import type { Metrics } from "#server/metrics";

export async function reconcileAndPublish(
  service: Pick<AlertService, "reconcile">,
  changes: ChangeBus,
  metrics: Metrics,
): Promise<void> {
  const result = await service.reconcile();
  metrics.increment("alert_dashboard_reconciliation_total");
  metrics.gauge(
    "alert_dashboard_reconciliation_drift",
    result.opened + result.resolved,
  );
  changes.publish("reconciliation");
}
