import { deliverActivityReport } from "./report-delivery-failure-activities.ts";
import { rethrowReportDeliveryFailure } from "#workflows/scout/report-delivery.ts";

export async function reportDeliveryFailureReplayProbe(): Promise<void> {
  try {
    await deliverActivityReport({ execution: "complete" });
  } catch (error) {
    rethrowReportDeliveryFailure(error);
    await deliverActivityReport({ execution: "failed" });
    throw error;
  }
}
