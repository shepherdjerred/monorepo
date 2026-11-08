import { Connection } from "@temporalio/client";
import { log } from "@temporalio/activity";
import { z } from "zod";
import { WorkerPoolSnapshotSchema } from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import {
  proveWorkerRetirement,
  retirementEffects,
} from "#lib/delivery/workers/worker-retirement.ts";

const CandidatesSchema = z.object({
  environments: z.array(
    z.object({
      environmentId: z.string(),
      generation: z.number().int().nonnegative(),
      pool: WorkerPoolSnapshotSchema,
      workers: z.array(
        z.object({
          id: z.string(),
          generation: z.number().int().nonnegative(),
          buildId: z.string(),
        }),
      ),
    }),
  ),
});

export type AutoRetirementResult = {
  requested: { environmentId: string; workerId: string }[];
  skipped: { environmentId: string; workerId: string; reason: string }[];
};

/**
 * Proposes, per idle worker environment, the first retained host whose
 * read-only retirement proof passes now (AI-472). Delivery requests the
 * guarded `retire-host` deployment itself, and the executor's fence re-proves
 * the host before scale-to-zero, so a proof that goes stale costs only a
 * refused retirement, which Delivery never retries automatically.
 */
export async function proposeDrainedRetirements<Pool>(
  candidates: {
    environments: {
      environmentId: string;
      generation: number;
      pool: Pool;
      workers: { id: string; generation: number }[];
    }[];
  },
  prove: (pool: Pool, workerId: string) => Promise<unknown>,
  request: (workerId: string, body: unknown) => Promise<void>,
): Promise<AutoRetirementResult> {
  const result: AutoRetirementResult = { requested: [], skipped: [] };
  for (const environment of candidates.environments) {
    for (const worker of environment.workers) {
      try {
        await prove(environment.pool, worker.id);
      } catch (error) {
        result.skipped.push({
          environmentId: environment.environmentId,
          workerId: worker.id,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      await request(worker.id, {
        expectedEnvironmentGeneration: environment.generation,
        expectedWorkerGeneration: worker.generation,
      });
      result.requested.push({
        environmentId: environment.environmentId,
        workerId: worker.id,
      });
      break;
    }
  }
  return result;
}

export async function retireDrainedWorkerHosts(): Promise<AutoRetirementResult> {
  const candidates = await deliveryRequest(
    "workers/retirement-candidates",
    CandidatesSchema,
  );
  if (candidates.environments.length === 0)
    return { requested: [], skipped: [] };
  const connection = await Connection.connect({
    address: "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
    connectTimeout: "10 seconds",
  });
  try {
    const result = await connection.withDeadline(
      Date.now() + 90_000,
      async () =>
        await proposeDrainedRetirements(
          candidates,
          async (pool, workerId) =>
            await proveWorkerRetirement(
              pool,
              workerId,
              retirementEffects(connection),
            ),
          async (workerId, body) => {
            await deliveryRequest(
              `workers/${encodeURIComponent(workerId)}/auto-retire`,
              z.object({ id: z.string() }),
              body,
            );
          },
        ),
    );
    if (result.requested.length > 0)
      log.info("Requested automatic worker retirements", {
        requested: result.requested,
      });
    return result;
  } finally {
    await connection.close();
  }
}
