import { deliverActivityReport } from "./report-delivery-failure-activities.ts";

export async function reportDeliveryFailureReplayProbe(): Promise<void> {
  try {
    await deliverActivityReport({ execution: "complete" });
  } catch (error) {
    await deliverActivityReport({ execution: "failed" });
    throw error;
  }
}
