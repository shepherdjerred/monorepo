import { DeliveryError } from "#domain/error.ts";
import {
  type Environment,
  type Principal,
  type StoredRecipeDefinition,
  type VersionSetRevision,
  WorkerPoolSnapshotSchema,
} from "#shared/contract.ts";
import { workerRolloutOf } from "#shared/model/recipe-view.ts";
import {
  automaticTarget,
  id,
  orderKey,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import { audit, lock } from "#infrastructure/delivery-records.ts";
import { AUTO_RETIRE_ACTOR } from "#infrastructure/worker-pool/auto-retirement.ts";
import { retiringWorker } from "#infrastructure/worker-pool/proof.ts";

export type RetirementReplacement = {
  retirementId: string;
  versionSetId: string;
};

function retirementStillPending(): never {
  throw new DeliveryError(
    "CONFLICT",
    "The retirement cannot yield to this release",
  );
}

/** Only a newer, currently selected worker release may take the queued slot. */
async function requireForwardSelection(
  tx: Transaction,
  env: Environment,
  selected: VersionSetRevision,
  acceptedSetId: string,
) {
  // Direct selection follows CI composition. A promotion reads its source
  // acceptance, which already changes under the global claim lock.
  if (env.promotionSourceEnvironmentId === null)
    await lock(tx, `versionSet:${env.serviceId}`);
  const target = await automaticTarget(tx, env);
  const prior = await tx.versionSet.findUniqueOrThrow({
    where: { id: acceptedSetId },
  });
  const priorKey = orderKey(prior.orderMajor, prior.orderMinor);
  if (
    priorKey === null ||
    selected.orderKey === null ||
    selected.orderKey <= priorKey ||
    selected.revision <= env.automaticSuppressedThroughRevision ||
    target?.id !== selected.id
  )
    retirementStillPending();
  // A queued maintenance request must not mask an earlier failed release (D2).
  const last = await tx.deployment.findFirst({
    where: {
      environmentId: env.id,
      kind: { notIn: ["adopt-worker", "repair-trmnl", "retire-host"] },
    },
    orderBy: { createdAt: "desc" },
    select: { status: true, versionSetRevisionId: true },
  });
  if (
    last?.versionSetRevisionId === selected.id &&
    ["failed", "canceled"].includes(last.status)
  )
    retirementStillPending();
}

/** Called under the global claim, exact deployment and environment locks. */
export async function supersedeAutomaticRetirement(
  tx: Transaction,
  input: {
    replacement: RetirementReplacement | undefined;
    environment: Environment;
    expectedGeneration: number;
    selected: VersionSetRevision;
    definition: StoredRecipeDefinition;
    kind: string;
    actor: Principal;
  },
) {
  const { environment: env, selected, definition, replacement } = input;
  if (replacement === undefined) return;
  const rollout = workerRolloutOf(definition);
  if (
    rollout === undefined ||
    selected.id !== replacement.versionSetId ||
    !env.automatic ||
    env.generation !== input.expectedGeneration ||
    env.activeDeploymentId !== null ||
    env.acceptedDeploymentId === null ||
    env.acceptedVersionSetRevisionId === null ||
    !["deploy", "promote"].includes(input.kind)
  )
    retirementStillPending();

  const row = await tx.deployment.findFirst({
    where: {
      id: replacement.retirementId,
      kind: "retire-host",
      requestedBy: AUTO_RETIRE_ACTOR.id,
      status: "queued",
      cancelRequested: false,
      recoveryRequired: false,
      startedAt: null,
      workflowId: null,
      workflowRunId: null,
      leaseExpiresAt: null,
      handoffAt: null,
      approval: { is: null },
      locks: { none: {} },
      stages: { none: {} },
      recoveryIntents: { none: {} },
      environmentId: env.id,
      expectedGeneration: env.generation,
      previousAcceptedDeploymentId: env.acceptedDeploymentId,
      versionSetRevisionId: env.acceptedVersionSetRevisionId,
    },
    select: { id: true, workerSnapshot: true, versionSetRevisionId: true },
  });
  if (row === null) retirementStillPending();
  const snapshot = WorkerPoolSnapshotSchema.parse(row.workerSnapshot);
  if (
    snapshot.workerOperation !== "retire" ||
    snapshot.environmentId !== env.id ||
    snapshot.environmentGeneration !== env.generation ||
    snapshot.restoredFromDeploymentId !== env.acceptedDeploymentId ||
    snapshot.target !== rollout.target
  )
    retirementStillPending();
  retiringWorker(snapshot);
  await requireForwardSelection(tx, env, selected, row.versionSetRevisionId);
  await tx.deployment.update({
    where: { id: row.id },
    data: {
      status: "canceled",
      cancelRequested: true,
      finishedAt: new Date(),
      message: `Superseded before execution by version set ${selected.id}`,
    },
  });
  await tx.outbox.deleteMany({ where: { deploymentId: row.id } });
  await audit(tx, input.actor, {
    action: "deployment.superseded",
    entityId: row.id,
    requestId: id(),
    metadata: { targetId: selected.id },
  });
}
