import { Connection } from "@temporalio/client";
import { KubeConfig } from "@kubernetes/client-node";
import { z } from "zod";
import { executePlatformRecoveryAction } from "#lib/delivery/platform/recovery/execute.ts";
import {
  closedPlatformWorkflow,
  provePlatformNativeJobs,
} from "#lib/delivery/platform/recovery/native-proof.ts";
import { recoveryJobReader } from "#lib/delivery/workers/worker-recovery-jobs.ts";
import { runDeliveryJob } from "#lib/delivery/job.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { dispatchRecoveryIntents } from "#activities/delivery/workers/worker-recovery-dispatch.ts";

export async function inspectDeliveryPlatformRecovery(id: string) {
  const connection = await Connection.connect({
    address: "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
    connectTimeout: "10 seconds",
  });
  const kubernetes = new KubeConfig();
  kubernetes.loadFromCluster();
  try {
    await executePlatformRecoveryAction(id, "inspect", {
      runJob: runDeliveryJob,
      closedWorkflow: async (deploymentId) =>
        await closedPlatformWorkflow(connection, deploymentId),
      nativeJobs: async (context) =>
        await provePlatformNativeJobs(
          context,
          recoveryJobReader(kubernetes, "delivery-platform-jobs"),
        ),
    });
  } finally {
    await connection.close();
  }
}
export async function failDeliveryPlatformRecovery(id: string) {
  await deliveryRequest(
    `platform-recovery/${encodeURIComponent(id)}/fail`,
    z.unknown(),
    {
      message:
        "Independent platform target inspection failed; original failed outcome and quarantine remain unchanged. Use bounded operator settlement and a fresh recovery intent.",
    },
  );
}
export async function dispatchDeliveryPlatformRecoveries() {
  await dispatchRecoveryIntents({
    path: "platform-recovery",
    workflowType: "deliveryPlatformRecoveryWorkflow",
  });
}
