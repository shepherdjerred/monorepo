import { createAlertmanagerPoster } from "#lib/alertmanager.ts";
import {
  buildLinkRotAlert,
  type LinkRotAlertInput,
} from "#shared/link-rot-alert.ts";

/**
 * Publishes the link-rot scan's fire/resolve occurrence to Alertmanager.
 * Runs on TASK_QUEUES.DEFAULT — the core worker owns ALERTMANAGER_URL.
 */
export const linkRotScanAlertActivities = {
  async publishLinkRotScanAlerts(input: LinkRotAlertInput): Promise<void> {
    const alertmanagerUrl = Bun.env["ALERTMANAGER_URL"];
    if (alertmanagerUrl === undefined || alertmanagerUrl === "") {
      throw new Error(
        "ALERTMANAGER_URL is required to publish link-rot scan alerts",
      );
    }
    await createAlertmanagerPoster(alertmanagerUrl)([
      buildLinkRotAlert(input, new Date()),
    ]);
  },
};

export type LinkRotScanAlertActivities = typeof linkRotScanAlertActivities;
