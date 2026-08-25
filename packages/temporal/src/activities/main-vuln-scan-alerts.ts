import { createAlertmanagerPoster } from "#lib/alertmanager.ts";
import {
  buildMainVulnScanAlert,
  type MainVulnScanAlertInput,
} from "#shared/main-vuln-scan-alert.ts";

/**
 * Publishes the scan's fire/resolve occurrence to Alertmanager. Runs on
 * TASK_QUEUES.DEFAULT — the core worker owns ALERTMANAGER_URL; the maintenance
 * worker deliberately has no Alertmanager access.
 */
export const mainVulnScanAlertActivities = {
  async publishMainVulnScanAlerts(
    input: MainVulnScanAlertInput,
  ): Promise<void> {
    const alertmanagerUrl = Bun.env["ALERTMANAGER_URL"];
    if (alertmanagerUrl === undefined || alertmanagerUrl === "") {
      throw new Error(
        "ALERTMANAGER_URL is required to publish main vulnerability scan alerts",
      );
    }
    await createAlertmanagerPoster(alertmanagerUrl)([
      buildMainVulnScanAlert(input, new Date()),
    ]);
  },
};

export type MainVulnScanAlertActivities = typeof mainVulnScanAlertActivities;
