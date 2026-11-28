import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  WorkerPoolSnapshotSchema,
  type Principal,
  type WorkerPoolSnapshot,
} from "#shared/contract.ts";
import { readWorkerVersions } from "./pool.ts";
import { requireUnreferencedWorker } from "./proof.ts";

/**
 * Delivery retires a drained retained host itself instead of waiting for a
 * person (AI-472). The executor proposes a host only after its read-only
 * retirement proof passes; the request still goes through every check an
 * operator retirement makes, and the executor's retirement fence re-proves
 * drainage and routing before the scale-to-zero. Nothing here trusts the
 * proposal beyond choosing which host to request.
 *
 * A failed or operator-canceled retirement leaves the host to an operator.
 * A superseded retirement did not try to drain the host and can be proposed
 * again after a different selection is accepted. An environment whose
 * releases require approval keeps retirements operator-requested.
 */
export const AUTO_RETIRE_ACTOR: Principal = {
  id: "delivery/auto-retire",
  kind: "machine",
  scopes: ["read", "deploy"],
};

export const AutoRetireWorkerSchema = z
  .object({
    expectedEnvironmentGeneration: z.number().int().nonnegative(),
    expectedWorkerGeneration: z.number().int().nonnegative(),
  })
  .strict();

export type RetirementCandidates = {
  environments: {
    environmentId: string;
    generation: number;
    pool: WorkerPoolSnapshot;
    workers: { id: string; generation: number; buildId: string }[];
  }[];
};

async function idleWorkerEnvironments(database: Delivery["database"]) {
  const environments = await database.environment.findMany({
    // An approval-gated environment's retirement stays an operator decision.
    where: {
      // Only an admitting environment accepts the retirement request.
      lifecycle: "active",
      activeDeploymentId: null,
      acceptedDeploymentId: { not: null },
      approvalPolicy: { not: "required" },
    },
    orderBy: { id: "asc" },
  });
  const idle = [];
  for (const env of environments) {
    const pending = await database.deployment.count({
      where: {
        environmentId: env.id,
        OR: [
          { status: { in: ["queued", "awaiting_approval", "running"] } },
          { recoveryRequired: true },
        ],
      },
    });
    if (pending === 0) idle.push(env);
  }
  return idle;
}

type RetirementEnvironment = {
  id: string;
  acceptedVersionSetRevisionId: string | null;
};

/** Failed or canceled retirements suppress a host, except an audited preclaim supersession after acceptance advances. */
async function attemptedRetirements(
  database: Delivery["database"],
  env: RetirementEnvironment,
): Promise<Set<string>> {
  const rows = await database.deployment.findMany({
    where: {
      environmentId: env.id,
      kind: "retire-host",
      status: { in: ["failed", "canceled"] },
    },
    select: {
      id: true,
      status: true,
      requestedBy: true,
      versionSetRevisionId: true,
      workerSnapshot: true,
    },
  });
  const possiblySuperseded = rows.filter(
    (row) =>
      row.status === "canceled" &&
      row.requestedBy === AUTO_RETIRE_ACTOR.id &&
      row.versionSetRevisionId !== env.acceptedVersionSetRevisionId,
  );
  const audit = await database.audit.findMany({
    where: {
      action: "deployment.superseded",
      entityId: { in: possiblySuperseded.map(({ id }) => id) },
    },
    select: { entityId: true },
  });
  const superseded = new Set(audit.map(({ entityId }) => entityId));
  return new Set(
    rows.flatMap((row) => {
      if (superseded.has(row.id)) return [];
      const snapshot = WorkerPoolSnapshotSchema.safeParse(row.workerSnapshot);
      const id = snapshot.success ? snapshot.data.retiringWorkerId : null;
      return id === null ? [] : [id];
    }),
  );
}

/** Whether no accepted routing or in-flight deployment still references a host. */
async function unreferenced(
  database: Delivery["database"],
  worker: Awaited<ReturnType<typeof readWorkerVersions>>[number],
): Promise<boolean> {
  try {
    await database.$transaction(async (tx) => {
      await requireUnreferencedWorker(tx, { worker });
    });
    return true;
  } catch (error) {
    if (error instanceof DeliveryError) return false;
    throw error;
  }
}

/** One idle environment's offer, or null when it has no retirable host. */
async function environmentCandidates(
  database: Delivery["database"],
  env: RetirementEnvironment & {
    generation: number;
    acceptedDeploymentId: string | null;
  },
): Promise<RetirementCandidates["environments"][number] | null> {
  const accepted = await database.deployment.findUnique({
    where: { id: env.acceptedDeploymentId ?? "" },
    select: { workerSnapshot: true },
  });
  const snapshot = accepted?.workerSnapshot ?? null;
  if (snapshot === null) return null;
  const baseline = WorkerPoolSnapshotSchema.parse(snapshot);
  const versions = await readWorkerVersions(database, env.id);
  const attempted = await attemptedRetirements(database, env);
  const workers = [];
  for (const worker of versions) {
    const live =
      worker.replicas === 1 &&
      worker.buildId !== baseline.candidateBuildId &&
      !attempted.has(worker.id);
    if (live && (await unreferenced(database, worker)))
      workers.push({
        id: worker.id,
        generation: worker.generation,
        buildId: worker.buildId,
      });
  }
  if (workers.length === 0) return null;
  return {
    environmentId: env.id,
    generation: env.generation,
    pool: WorkerPoolSnapshotSchema.parse({ ...baseline, versions }),
    workers,
  };
}

/**
 * Idle, active worker environments and their retained hosts that an operator could
 * retire now: live, not the accepted candidate, unreferenced, and never
 * refused before. The pool carries the current host rows so the executor
 * proves the exact host it proposes.
 */
export async function retirementCandidates(
  this: Delivery,
  actor: Principal,
): Promise<RetirementCandidates> {
  requireScope(actor, "execute");
  const environments: RetirementCandidates["environments"] = [];
  for (const env of await idleWorkerEnvironments(this.database)) {
    const offer = await environmentCandidates(this.database, env);
    if (offer !== null) environments.push(offer);
  }
  return { environments };
}

/**
 * Requests the guarded retirement of a host the executor proved drained,
 * as `delivery/auto-retire`, with an idempotent request per host and environment generation.
 */
export async function autoRetireWorker(
  this: Delivery,
  workerId: string,
  rawInput: unknown,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const input = AutoRetireWorkerSchema.parse(rawInput);
  const worker = await this.database.workerVersion.findUnique({
    where: { id: workerId },
    select: {
      environment: { select: { id: true, acceptedVersionSetRevisionId: true } },
    },
  });
  if (worker === null)
    throw new DeliveryError("NOT_FOUND", "Worker version not found");
  const legacyRequestId = `auto-retire-${workerId}-${input.expectedWorkerGeneration.toString()}`;
  const requestId = `${legacyRequestId}-${input.expectedEnvironmentGeneration.toString()}`;
  // Existing requests retain their original idempotent identity on an exact replay.
  const replay = await this.database.deployment.findFirst({
    where: {
      environmentId: worker.environment.id,
      kind: "retire-host",
      requestedBy: AUTO_RETIRE_ACTOR.id,
      expectedGeneration: input.expectedEnvironmentGeneration,
      requestId: { in: [requestId, legacyRequestId] },
    },
    select: { id: true, requestId: true },
  });
  const attempted = await attemptedRetirements(
    this.database,
    worker.environment,
  );
  if (attempted.has(workerId)) {
    // An exact superseded request can still be replayed after a later
    // attempt leaves the host to an operator. The request ledger returns the
    // original cancellation without creating another retirement.
    const superseded =
      replay === null
        ? null
        : await this.database.audit.findFirst({
            where: { action: "deployment.superseded", entityId: replay.id },
            select: { id: true },
          });
    if (superseded === null)
      throw new DeliveryError(
        "CONFLICT",
        "This host's retirement already failed; an operator decides",
      );
  }
  return this.retireWorker(
    workerId,
    {
      requestId: replay?.requestId ?? requestId,
      ...input,
    },
    AUTO_RETIRE_ACTOR,
  );
}
