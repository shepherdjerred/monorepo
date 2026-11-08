import { z } from "zod";
import type {
  CompleteWorkerRecovery,
  WorkerPoolSnapshot,
  WorkerRecoveryContext,
} from "@shepherdjerred/delivery/contract";
import { verifyWorkerBaselinePods } from "./worker-hosts.ts";
import {
  requireFailedOwnedSync,
  type ModelWorkerRecovery,
} from "./worker-recovery-model.ts";

/** The read-only effects this proof needs, a subset of the worker recovery effects. */
type HostEffects = {
  resources: (application: string, kind: "Pod") => Promise<unknown[]>;
  noCandidateReferences: (pool: WorkerPoolSnapshot) => Promise<void>;
};

/**
 * A model sync that failed before any routing step: the candidate host may
 * exist but serves nothing. No execution references it, and every retained
 * host still runs its exact image.
 */
async function requireUnroutedCandidateHosts(
  context: WorkerRecoveryContext,
  pool: WorkerPoolSnapshot,
  effects: HostEffects,
  application: string,
) {
  await effects.noCandidateReferences(pool);
  verifyWorkerBaselinePods(await effects.resources(application, "Pod"), {
    ...pool,
    versions: pool.versions.filter(
      (worker) =>
        worker.introducedByDeploymentId !== context.deployment.deployment.id,
    ),
  });
}

function requireCandidateUnrouted(
  pool: WorkerPoolSnapshot,
  routes: CompleteWorkerRecovery["routes"],
) {
  if (routes.some((route) => route.currentBuildId === pool.candidateBuildId))
    throw new Error("A failed worker sync's candidate owns current routing");
}

export function failedOperation(raw: unknown): boolean {
  const phase = z
    .object({
      status: z.object({
        operationState: z.object({ phase: z.string() }).optional(),
      }),
    })
    .safeParse(raw);
  return (
    phase.success &&
    ["Failed", "Error"].includes(phase.data.status.operationState?.phase ?? "")
  );
}

/** The failed owned sync's classification: no operation, no legacy coverage, its own sync reading. */
export async function classifyFailedSync(
  context: WorkerRecoveryContext,
  pool: WorkerPoolSnapshot,
  effects: HostEffects,
  target: { model: ModelWorkerRecovery; name: string; before: unknown },
) {
  const detail = context.deployment;
  const { receipt } = requireFailedOwnedSync(
    target.before,
    detail,
    target.model,
  );
  await requireUnroutedCandidateHosts(context, pool, effects, target.name);
  return {
    unappliedBootstrap: false,
    operated: false,
    owned: undefined,
    source: "failed-sync" as const,
    receipt,
    checkRoutes: (routes: CompleteWorkerRecovery["routes"]) => {
      requireCandidateUnrouted(pool, routes);
    },
    sync: (raw: unknown) => {
      const observed = requireFailedOwnedSync(raw, detail, target.model);
      if (observed.receipt !== receipt)
        throw new Error("Failed worker sync changed during recovery proof");
      return observed.sync;
    },
  };
}

export function settledNote(source: "prior" | "written" | "failed-sync") {
  if (source === "written")
    return "; the unsynced candidate body stays for the next deployment to replace";
  return source === "failed-sync"
    ? "; the owned sync failed before any routing step, the candidate is unrouted and unreferenced, and its body stays for the next deployment to replace"
    : "";
}
