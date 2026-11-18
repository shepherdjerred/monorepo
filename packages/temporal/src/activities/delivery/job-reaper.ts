import { BatchV1Api, KubeConfig } from "@kubernetes/client-node";
import { Context, log } from "@temporalio/activity";
import { z } from "zod";
import { deliveryRequest } from "#lib/delivery/client.ts";
import {
  DELIVERY_PLATFORM_JOBS_NAMESPACE,
  DELIVERY_WORKER_JOBS_NAMESPACE,
  reapSettledDeliveryJobs,
  type DeliveryJobReapResult,
  type DeliveryJobReaperNamespace,
} from "#lib/delivery/job-reaper.ts";

async function reapNamespace(
  namespace: DeliveryJobReaperNamespace,
): Promise<DeliveryJobReapResult> {
  const kubernetes = new KubeConfig();
  kubernetes.loadFromCluster();
  const context = Context.current();
  const result = await reapSettledDeliveryJobs({
    namespace,
    jobs: kubernetes.makeApiClient(BatchV1Api),
    inspectDeployment: async (deploymentId) =>
      await deliveryRequest(
        `deployments/${encodeURIComponent(deploymentId)}`,
        z.unknown(),
      ),
    heartbeat: (detail) => {
      context.heartbeat(detail);
    },
    signal: context.cancellationSignal,
  });
  if (result.deleted.length > 0) {
    log.info("Reaped settled Delivery stage Jobs", {
      namespace: result.namespace,
      deletedCount: result.deleted.length,
      scanned: result.scanned,
      skippedUnsettled: result.skippedUnsettled,
    });
  }
  return result;
}

export async function reapSettledDeliveryWorkerJobs(): Promise<DeliveryJobReapResult> {
  return await reapNamespace(DELIVERY_WORKER_JOBS_NAMESPACE);
}

export async function reapSettledDeliveryPlatformJobs(): Promise<DeliveryJobReapResult> {
  return await reapNamespace(DELIVERY_PLATFORM_JOBS_NAMESPACE);
}
