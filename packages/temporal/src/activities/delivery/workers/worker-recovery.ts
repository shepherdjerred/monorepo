import { Connection } from "@temporalio/client";
import { KubeConfig } from "@kubernetes/client-node";
import { z } from "zod";
import { WorkerRecoveryContextSchema } from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { proveSettledWorkerRecovery } from "#lib/delivery/workers/worker-recovery.ts";
import { workerRecoveryEffects } from "#lib/delivery/workers/worker-recovery-effects.ts";
import { argoRequest } from "#activities/delivery/argocd.ts";

export async function inspectDeliveryWorkerRecovery(id: string): Promise<void> {
  const path = `worker-recovery/${encodeURIComponent(id)}`;
  const context = await deliveryRequest(path, WorkerRecoveryContextSchema);
  if (context.intent.status !== "pending") return;
  const connection = await Connection.connect({
    address: "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
    connectTimeout: "10 seconds",
  });
  const kubernetes = new KubeConfig();
  kubernetes.loadFromCluster();
  try {
    const proof = await connection.withDeadline(
      Date.now() + 20 * 60_000,
      async () =>
        await proveSettledWorkerRecovery(
          context,
          workerRecoveryEffects({
            connection,
            kubernetes,
            readArgo: argoRequest,
          }),
        ),
    );
    await deliveryRequest(`${path}/complete`, z.unknown(), proof);
  } finally {
    await connection.close();
  }
}

export async function failDeliveryWorkerRecovery(id: string): Promise<void> {
  await deliveryRequest(
    `worker-recovery/${encodeURIComponent(id)}/fail`,
    z.unknown(),
    {
      message:
        "Independent worker recovery proof failed; failed release and its ownership remain unchanged. Inspect exact Workflow/Job/native operation receipts.",
    },
  );
}
