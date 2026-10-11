import { proxyActivities } from "@temporalio/workflow";

export const { deliverActivityReport } = proxyActivities<{
  deliverActivityReport: (input: {
    execution: "complete" | "failed";
  }) => Promise<void>;
}>({ startToCloseTimeout: "10 seconds", retry: { maximumAttempts: 1 } });
