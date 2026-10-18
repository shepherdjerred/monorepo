import { dispatchRecoveryIntents } from "#activities/delivery/workers/worker-recovery-dispatch.ts";

/** Read-only original provenance uses the same stable native-intent dispatch protocol. */
export async function dispatchDeliveryForumBaselines(): Promise<void> {
  await dispatchRecoveryIntents({
    path: "forum/baselines",
    workflowType: "deliveryForumBaselineWorkflow",
  });
}
