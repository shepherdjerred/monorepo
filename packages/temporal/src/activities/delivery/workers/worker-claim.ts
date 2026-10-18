import { Connection } from "@temporalio/client";
import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import {
  proveWorkerRetirement,
  retirementEffects,
} from "#lib/delivery/workers/worker-retirement.ts";
import { deliveryWorkerPool } from "#lib/delivery/workers/worker-pool.ts";

export async function workerRetirementClaim(detail: DeploymentDetail) {
  const pool = deliveryWorkerPool(detail);
  if (pool?.workerOperation !== "retire") return {};
  if (pool.retiringWorkerId === null)
    throw new Error("Missing retirement worker identity");
  const connection = await Connection.connect({
    address: "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
    connectTimeout: "10 seconds",
  });
  try {
    return await connection.withDeadline(
      Date.now() + 45_000,
      async () =>
        await proveWorkerRetirement(
          pool,
          pool.retiringWorkerId ?? "",
          retirementEffects(connection),
        ),
    );
  } finally {
    await connection.close();
  }
}
