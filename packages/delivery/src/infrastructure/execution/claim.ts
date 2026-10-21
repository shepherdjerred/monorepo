import { DeliveryError } from "#domain/error.ts";
import {
  LegacyPipelineRevisionSchema,
  WorkerPoolSnapshotSchema,
} from "#shared/contract.ts";
import type {
  ExecutorIdentity,
  Principal,
  WorkerRetirementClaim,
  TrmnlRepairClaim,
} from "#shared/contract.ts";
import {
  wire,
  lock,
  required,
  audit,
} from "#infrastructure/delivery-records.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  id,
  environment,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import { materializeWorkerSnapshot } from "#infrastructure/worker-pool/pool.ts";
import { validateWorkerRetirementClaim } from "#infrastructure/worker-pool/retirement.ts";
import { admitPlatformDeployment } from "#infrastructure/platform/lifecycle.ts";
import {
  requireControlPlaneQuiescence,
  admitControlPlaneUpgrade,
} from "#infrastructure/control-plane/lifecycle.ts";
import { requireStaticRootBoundary } from "#infrastructure/platform/static-prerequisite.ts";
import { claimTrmnlRepair } from "#infrastructure/trmnl-repair/claim.ts";
import { readmitDeployment } from "#infrastructure/execution/readmission.ts";
import { requireNoContentBarrier } from "#infrastructure/content-recovery/ownership.ts";
import {
  expireApproval,
  leaseExpiry,
  observesApplication,
  requireSameExecutor,
  targetInstances,
  type DeploymentRow,
} from "#infrastructure/execution/ownership.ts";

function repairClaimProof(
  proof: WorkerRetirementClaim | TrmnlRepairClaim | undefined,
) {
  return proof !== undefined && "sourceWorkflow" in proof ? proof : undefined;
}
function retirementClaimProof(
  proof: WorkerRetirementClaim | TrmnlRepairClaim | undefined,
) {
  if (proof === undefined) return;
  if ("proofs" in proof) return proof;
  throw new DeliveryError(
    "INVALID",
    "Repair proof belongs only to a TRMNL repair deployment",
  );
}
type ClaimInput = {
  deploymentId: string;
  actor: Principal;
  claimProof: WorkerRetirementClaim | TrmnlRepairClaim | undefined;
  executor: ExecutorIdentity | undefined;
  owned: { leaseExpiresAt: Date } & Partial<ExecutorIdentity>;
  concurrency: number;
};

/** A request whose binding generation moved fails before any effect (E2, H2). */
async function rejectStale(tx: Transaction, input: ClaimInput) {
  await tx.deployment.update({
    where: { id: input.deploymentId },
    data: {
      status: "failed",
      message: "Deployment inputs are stale; request a new deployment",
      finishedAt: new Date(),
    },
  });
  await expireApproval(tx, input.deploymentId);
  await tx.outbox.deleteMany({ where: { deploymentId: input.deploymentId } });
  await audit(tx, input.actor, {
    action: "deployment.admission_rejected",
    entityId: input.deploymentId,
    requestId: id(),
  });
  return { status: "rejected" } as const;
}

/** Every instance lock the deployment needs must be free or already its own (T1). */
async function requireFreeInstances(
  tx: Transaction,
  deploymentId: string,
  instances: string[],
) {
  if (instances.length === 0)
    throw new DeliveryError("INVALID", "Pipeline has no deployment target");
  for (const instance of instances) {
    const held = await tx.targetLock.findUnique({ where: { instance } });
    if (held !== null && held.deploymentId !== deploymentId)
      throw new DeliveryError(
        "BUSY",
        `Deployment target ${instance} is owned by another deployment`,
      );
  }
}

async function admitRetirement(
  tx: Transaction,
  row: DeploymentRow,
  input: ClaimInput,
) {
  const retirementProof = retirementClaimProof(input.claimProof);
  if (row.kind !== "retire-host") {
    if (retirementProof !== undefined)
      throw new DeliveryError(
        "INVALID",
        "Retirement proof belongs only to a retirement deployment",
      );
    return;
  }
  const proof = await validateWorkerRetirementClaim(tx, {
    deployment: row,
    proof: retirementProof,
    running: false,
  });
  await audit(tx, input.actor, {
    action: "worker.retirement_proved",
    entityId: row.id,
    requestId: id(),
    metadata: proof,
  });
}

/** Admission of a queued deployment: generation, bound, prerequisites, then every lock. */
async function admitQueued(
  this: Delivery,
  tx: Transaction,
  row: DeploymentRow,
  input: ClaimInput,
) {
  const { deploymentId } = input;
  await lock(tx, `environment:${row.environmentId}`);
  const env = await environment(tx, row.environmentId);
  if (env.generation !== row.expectedGeneration) return rejectStale(tx, input);
  if (env.activeDeploymentId !== null)
    throw new DeliveryError("BUSY", "Environment has an active deployment");
  const running = await tx.deployment.count({
    where: { status: "running", id: { not: deploymentId } },
  });
  if (running >= input.concurrency)
    throw new DeliveryError(
      "BUSY",
      "Executor concurrency bound is reached; the deployment stays queued",
    );
  const pipeline = LegacyPipelineRevisionSchema.parse(
    wire(
      required(
        await tx.pipeline.findUnique({ where: { id: row.pipelineRevisionId } }),
        "Pipeline",
      ),
    ),
  );
  const instances = targetInstances(pipeline.definition, env.application);
  await requireFreeInstances(tx, deploymentId, instances);
  await admitPlatformDeployment(tx, row, this.catalog, { actor: input.actor });
  await requireStaticRootBoundary(tx, {
    row,
    catalog: this.catalog,
    repositoryId: this.repositoryId,
  });
  await admitControlPlaneUpgrade(tx, row, this.catalog);
  await admitRetirement(tx, row, input);
  await tx.targetLock.createMany({
    data: instances.map((instance) => ({ instance, deploymentId })),
    skipDuplicates: true,
  });
  if (
    row.workerSnapshot !== null &&
    row.kind !== "retire-host" &&
    row.kind !== "adopt-worker"
  )
    await materializeWorkerSnapshot(
      tx,
      WorkerPoolSnapshotSchema.parse(row.workerSnapshot),
    );
  // Claim records desire and ownership only; the environment's declared
  // binding and generation change on acceptance alone (model E1, E3).
  await tx.environment.update({
    where: { id: env.id },
    data: {
      activeDeploymentId: deploymentId,
      ...(observesApplication(row)
        ? { desiredVersionSetRevisionId: row.versionSetRevisionId }
        : {}),
    },
  });
  await tx.deployment.update({
    where: { id: deploymentId },
    data: { status: "running", startedAt: new Date(), ...input.owned },
  });
  await audit(tx, input.actor, {
    action: "deployment.claimed",
    entityId: deploymentId,
    requestId: id(),
    metadata: { instances, ...input.executor },
  });
  return { status: "claimed" } as const;
}

async function admitClaim(this: Delivery, tx: Transaction, input: ClaimInput) {
  const { deploymentId, actor } = input;
  await lock(tx, "delivery:claim");
  await requireNoContentBarrier(tx);
  await lock(tx, `deployment:${deploymentId}`);
  const row = required(
    await tx.deployment.findUnique({ where: { id: deploymentId } }),
    "Deployment",
  );
  await requireControlPlaneQuiescence(tx, row);
  requireSameExecutor(row, input.executor);
  if (row.kind === "repair-trmnl") {
    await claimTrmnlRepair(tx, row, repairClaimProof(input.claimProof), actor);
    await tx.deployment.update({
      where: { id: deploymentId },
      data: input.owned,
    });
    return { status: "claimed" } as const;
  }
  if (row.status === "running") {
    // The same workflow resumes after a transient failure (D7).
    await readmitDeployment.call(this, tx, row, {
      actor,
      retirementProof: retirementClaimProof(input.claimProof),
    });
    await tx.deployment.update({
      where: { id: deploymentId },
      data: input.owned,
    });
    return { status: "claimed" } as const;
  }
  if (row.status !== "queued")
    throw new DeliveryError("CONFLICT", "Deployment is not queued");
  return admitQueued.call(this, tx, row, input);
}

/**
 * Takes ownership of a deployment for one executor identity under a lease
 * (D7), within the global concurrency bound (D10).
 */
export async function claim(
  this: Delivery,
  ...args: [
    deploymentId: string,
    actor: Principal,
    claimProof?: WorkerRetirementClaim | TrmnlRepairClaim,
    executor?: ExecutorIdentity,
  ]
) {
  const [deploymentId, actor, claimProof, executor] = args;
  const [leaseSeconds, concurrency] = await Promise.all([
    this.policy.leaseSeconds(),
    this.policy.executorConcurrency(),
  ]);
  const input: ClaimInput = {
    deploymentId,
    actor,
    claimProof,
    executor,
    owned: { leaseExpiresAt: leaseExpiry(leaseSeconds), ...executor },
    concurrency,
  };
  const admission = await this.database.$transaction((tx) =>
    admitClaim.call(this, tx, input),
  );
  if (admission.status === "rejected")
    throw new DeliveryError(
      "CONFLICT",
      "Deployment inputs are stale; request a new deployment",
    );
  return this.detail(deploymentId);
}
