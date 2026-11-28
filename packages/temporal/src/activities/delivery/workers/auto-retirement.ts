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

export type LiveWorkerRouteObservation = {
  currentBuildId: string;
  rampingBuildId: string | null;
};

const PoolCandidateSchema = z.object({
  candidateBuildId: z.string().optional(),
});

function poolCandidateBuildId(pool: unknown): string | undefined {
  const parsed = PoolCandidateSchema.safeParse(pool);
  return parsed.success ? parsed.data.candidateBuildId : undefined;
}

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
      workers: { id: string; generation: number; buildId?: string }[];
    }[];
  },
  prove: (pool: Pool, workerId: string) => Promise<unknown>,
  request: (workerId: string, body: unknown) => Promise<void>,
  observeLiveRoutes?: (pool: Pool) => Promise<LiveWorkerRouteObservation[]>,
): Promise<AutoRetirementResult> {
  const result: AutoRetirementResult = { requested: [], skipped: [] };
  const refused: unknown[] = [];
  for (const environment of candidates.environments) {
    const proved = await firstProved(
      environment,
      prove,
      result,
      observeLiveRoutes,
    );
    if (proved === undefined) continue;
    try {
      await request(proved.id, {
        expectedEnvironmentGeneration: environment.generation,
        expectedWorkerGeneration: proved.generation,
      });
      result.requested.push({
        environmentId: environment.environmentId,
        workerId: proved.id,
      });
    } catch (error) {
      // One environment's refusal never stops the others' proposals.
      refused.push(error);
    }
  }
  if (refused.length > 0) throw refused[0];
  return result;
}

async function resolveLiveActiveBuilds<Pool>(
  environment: {
    environmentId: string;
    pool: Pool;
    workers: { id: string; generation: number; buildId?: string }[];
  },
  result: AutoRetirementResult,
  observeLiveRoutes?: (pool: Pool) => Promise<LiveWorkerRouteObservation[]>,
): Promise<Set<string> | "lagging"> {
  if (observeLiveRoutes === undefined) return new Set<string>();
  const routes = await observeLiveRoutes(environment.pool);
  const acceptedBuild = poolCandidateBuildId(environment.pool);
  const environmentLagsLive =
    acceptedBuild !== undefined &&
    routes.some(
      (route) =>
        route.currentBuildId !== acceptedBuild ||
        (route.rampingBuildId !== null && route.rampingBuildId !== ""),
    );
  if (environmentLagsLive) {
    for (const worker of environment.workers) {
      result.skipped.push({
        environmentId: environment.environmentId,
        workerId: worker.id,
        reason:
          "Environment accepted worker lags live Temporal routing; settle acceptance before retiring hosts",
      });
    }
    return "lagging";
  }
  return new Set(
    routes.flatMap((route) =>
      route.rampingBuildId === null || route.rampingBuildId === ""
        ? [route.currentBuildId]
        : [route.currentBuildId, route.rampingBuildId],
    ),
  );
}

/** The environment's first host whose proof passes; failures are recorded as skipped. */
async function firstProved<Pool>(
  environment: {
    environmentId: string;
    pool: Pool;
    workers: { id: string; generation: number; buildId?: string }[];
  },
  prove: (pool: Pool, workerId: string) => Promise<unknown>,
  result: AutoRetirementResult,
  observeLiveRoutes?: (pool: Pool) => Promise<LiveWorkerRouteObservation[]>,
) {
  const liveActiveBuilds = await resolveLiveActiveBuilds(
    environment,
    result,
    observeLiveRoutes,
  );
  if (liveActiveBuilds === "lagging") return;
  for (const worker of environment.workers) {
    if (worker.buildId !== undefined && liveActiveBuilds.has(worker.buildId)) {
      result.skipped.push({
        environmentId: environment.environmentId,
        workerId: worker.id,
        reason: "Retained worker still owns current or ramping routing",
      });
      continue;
    }
    try {
      await prove(environment.pool, worker.id);
      return worker;
    } catch (error) {
      result.skipped.push({
        environmentId: environment.environmentId,
        workerId: worker.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return;
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
    const effects = retirementEffects(connection);
    const result = await connection.withDeadline(
      Date.now() + 90_000,
      async () =>
        await proposeDrainedRetirements(
          candidates,
          async (pool, workerId) =>
            await proveWorkerRetirement(pool, workerId, effects),
          async (workerId, body) => {
            await deliveryRequest(
              `workers/${encodeURIComponent(workerId)}/auto-retire`,
              z.object({ id: z.string() }),
              body,
            );
          },
          async (pool) => {
            const routes = pool.versions[0]?.host.routes ?? [];
            return await Promise.all(
              routes.map(async (route) => {
                const observed = await effects.routing(route);
                return {
                  currentBuildId: observed.currentBuildId,
                  rampingBuildId: observed.rampingBuildId,
                };
              }),
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
