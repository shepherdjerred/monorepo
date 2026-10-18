import { proxyActivities } from "@temporalio/workflow";

/** Deliberately incompatible candidate used only by retained-history replay regression. */
export async function deliveryDeploymentWorkflow(_input: {
  deploymentId: string;
}) {
  const activities = proxyActivities<{
    incompatibleBeforeUpgrade: () => Promise<void>;
  }>({ taskQueue: "never-polled", startToCloseTimeout: "1 minute" });
  await activities.incompatibleBeforeUpgrade();
}
