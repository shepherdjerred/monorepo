import { DeliveryError } from "#domain/error.ts";
import {
  DeploymentSchema,
  PipelineRevisionSchema,
  WorkerPoolSnapshotSchema,
} from "#shared/contract.ts";
import type {
  EvidenceInput,
  FinishDeployment,
  Principal,
  StageInput,
  WorkerRetirementClaim,
  TrmnlRepairClaim,
  PipelineDefinition,
} from "#shared/contract.ts";
import {
  fingerprint,
  wire,
  lock,
  required,
  audit,
  validateFinish,
} from "./delivery-records.ts";
import type { Delivery } from "./delivery.ts";
import {
  terminal,
  id,
  environment,
  evidence,
  type Transaction,
} from "./delivery-data.ts";
import { materializeWorkerSnapshot } from "./worker-pool/pool.ts";
import {
  acceptWorkerRetirement,
  validateWorkerRetirementClaim,
} from "./worker-pool/retirement.ts";
import { acceptWorkerBaseline } from "./worker-pool/baseline.ts";
import { validateSpecializedSuccess } from "./specialized-success.ts";
import {
  admitPlatformDeployment,
  validatePlatformSuccess,
} from "./platform/lifecycle.ts";
import {
  requireControlPlaneQuiescence,
  admitControlPlaneUpgrade,
  validateControlPlaneSuccess,
} from "./control-plane/lifecycle.ts";
import { requireStaticRootBoundary } from "./platform/static-prerequisite.ts";
import { claimTrmnlRepair } from "./trmnl-repair/claim.ts";
import { readmitDeployment } from "./deployment-readmission.ts";
import { requireNoContentBarrier } from "./content-recovery/ownership.ts";

function observesApplication(row: {
  kind: string;
  platformSnapshot: unknown;
  controlPlaneSnapshot: unknown;
}) {
  return (
    row.kind !== "adopt-worker" &&
    row.kind !== "repair-trmnl" &&
    row.platformSnapshot === null &&
    row.controlPlaneSnapshot === null
  );
}

function acceptedPointers(
  row: {
    id: string;
    kind: string;
    versionSetRevisionId: string;
    platformSnapshot: unknown;
    controlPlaneSnapshot: unknown;
  },
  status: string,
) {
  if (status !== "succeeded") return {};
  if (observesApplication(row))
    return { acceptedVersionSetRevisionId: row.versionSetRevisionId };
  return row.kind === "upgrade-control-plane"
    ? { acceptedControlPlaneDeploymentId: row.id }
    : ["root-release", "tofu-apply"].includes(row.kind)
      ? { acceptedPlatformDeploymentId: row.id }
      : {};
}

function deploymentTarget(
  pipeline: PipelineDefinition,
  application: string | null,
) {
  if (pipeline.kind === "static-site") return `static-site:${pipeline.bucket}`;
  return pipeline.kind === "tofu" ? `tofu:${pipeline.stack}` : application;
}

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
export async function claim(
  this: Delivery,
  deploymentId: string,
  actor: Principal,
  claimProof?: WorkerRetirementClaim | TrmnlRepairClaim,
) {
  const admission = await this.database.$transaction(async (tx) => {
    await lock(tx, "delivery:claim");
    await requireNoContentBarrier(tx);
    await lock(tx, `deployment:${deploymentId}`);
    const row = required(
      await tx.deployment.findUnique({ where: { id: deploymentId } }),
      "Deployment",
    );
    await requireControlPlaneQuiescence(tx, row);
    if (row.kind === "repair-trmnl") {
      await claimTrmnlRepair(tx, row, repairClaimProof(claimProof), actor);
      return { status: "claimed" };
    }
    const retirementProof = retirementClaimProof(claimProof);
    if (row.status === "running") {
      await readmitDeployment.call(this, tx, row, { actor, retirementProof });
      return { status: "claimed" };
    }
    if (row.status !== "queued")
      throw new DeliveryError("CONFLICT", "Deployment is not queued");
    await lock(tx, `environment:${row.environmentId}`);
    const env = await environment(tx, row.environmentId);
    // Every environment registration increments generation; selected rollback
    // inputs intentionally differ from the current desired configuration.
    if (env.generation !== row.expectedGeneration) {
      await tx.deployment.update({
        where: { id: deploymentId },
        data: {
          status: "failed",
          message: "Deployment inputs are stale; request a new deployment",
          finishedAt: new Date(),
        },
      });
      await tx.outbox.deleteMany({ where: { deploymentId } });
      await audit(tx, actor, {
        action: "deployment.admission_rejected",
        entityId: deploymentId,
        requestId: id(),
      });
      return { status: "rejected" };
    }
    if (env.activeDeploymentId !== null)
      throw new DeliveryError("BUSY", "Environment has an active deployment");
    const pipeline = PipelineRevisionSchema.parse(
      wire(
        required(
          await tx.pipeline.findUnique({
            where: { id: row.pipelineRevisionId },
          }),
          "Pipeline",
        ),
      ),
    );
    const target = deploymentTarget(pipeline.definition, env.application);
    if (target === null)
      throw new DeliveryError("INVALID", "Pipeline has no deployment target");
    const held = await tx.applicationLock.findUnique({
      where: { application: target },
    });
    if (held !== null)
      throw new DeliveryError(
        "BUSY",
        "Deployment target is owned by another deployment",
      );
    await admitPlatformDeployment(tx, row, this.catalog, { actor });
    await requireStaticRootBoundary(tx, {
      row,
      catalog: this.catalog,
      repositoryId: this.repositoryId,
    });
    await admitControlPlaneUpgrade(tx, row, this.catalog);
    if (row.kind === "retire-worker") {
      const proof = await validateWorkerRetirementClaim(tx, {
        deployment: row,
        proof: retirementProof,
        running: false,
      });
      await audit(tx, actor, {
        action: "worker.retirement_proved",
        entityId: row.id,
        requestId: id(),
        metadata: proof,
      });
    } else if (retirementProof !== undefined)
      throw new DeliveryError(
        "INVALID",
        "Retirement proof belongs only to a retirement deployment",
      );
    await tx.applicationLock.create({
      data: { application: target, deploymentId },
    });
    if (
      row.workerSnapshot !== null &&
      row.kind !== "retire-worker" &&
      row.kind !== "adopt-worker"
    )
      await materializeWorkerSnapshot(
        tx,
        WorkerPoolSnapshotSchema.parse(row.workerSnapshot),
      );
    await tx.environment.update({
      where: { id: env.id },
      data: {
        activeDeploymentId: deploymentId,
        ...(observesApplication(row)
          ? {
              desiredVersionSetRevisionId: row.versionSetRevisionId,
              pipelineRevisionId: row.pipelineRevisionId,
              configurationRevision: row.configurationRevision,
              configuration: DeploymentSchema.parse(wire(row)).configuration,
            }
          : {}),
        generation: { increment: 1 },
      },
    });
    await tx.deployment.update({
      where: { id: deploymentId },
      data: { status: "running", startedAt: new Date() },
    });
    await audit(tx, actor, {
      action: "deployment.claimed",
      entityId: deploymentId,
      requestId: id(),
    });
    return { status: "claimed" };
  });
  if (admission.status === "rejected")
    throw new DeliveryError(
      "CONFLICT",
      "Deployment inputs are stale; request a new deployment",
    );
  return this.detail(deploymentId);
}

export async function stage(
  this: Delivery,
  deploymentId: string,
  input: StageInput,
  actor: Principal,
) {
  return this.database.$transaction(async (tx) => {
    await lock(tx, `deployment:${deploymentId}`);
    const row = required(
      await tx.deployment.findUnique({ where: { id: deploymentId } }),
      "Deployment",
    );
    if (row.status !== "running")
      throw new DeliveryError(
        "CONFLICT",
        "Deployment must own the target before recording stages",
      );
    const existing = await tx.stage.findUnique({
      where: { deploymentId_key: { deploymentId, key: input.key } },
    });
    if (existing === null && row.cancelRequested && input.status === "running")
      throw new DeliveryError(
        "CONFLICT",
        "Cancellation was requested before this external mutation boundary",
      );
    if (existing !== null && existing.operationId !== input.operationId)
      throw new DeliveryError(
        "CONFLICT",
        "Stage operation identity cannot change",
      );
    if (
      existing !== null &&
      existing.status !== "running" &&
      (existing.status !== input.status || existing.message !== input.message)
    )
      throw new DeliveryError(
        "CONFLICT",
        "Completed stage cannot be rewritten",
      );
    const { evidence: items, ...data } = input;
    const updated = await tx.stage.upsert({
      where: { deploymentId_key: { deploymentId, key: input.key } },
      create: { id: id(), deploymentId, ...data },
      update: data,
    });
    await evidence(tx, deploymentId, items, `stage/${input.key}`);
    await audit(tx, actor, {
      action: "deployment.stage",
      entityId: deploymentId,
      requestId: input.operationId,
      metadata: { stage: input.key, status: input.status },
    });
    return wire(updated);
  });
}

export async function finish(
  this: Delivery,
  deploymentId: string,
  input: FinishDeployment,
  actor: Principal,
) {
  return this.database.$transaction(async (tx) => {
    await lock(tx, "delivery:claim");
    await lock(tx, `deployment:${deploymentId}`);
    const row = required(
      await tx.deployment.findUnique({ where: { id: deploymentId } }),
      "Deployment",
    );
    if (terminal.has(row.status)) {
      if (
        row.status !== input.status ||
        row.message !== input.message ||
        row.resultFingerprint !== fingerprint(input)
      )
        throw new DeliveryError("CONFLICT", "Deployment result is immutable");
      return DeploymentSchema.parse(wire(row));
    }
    if (row.status !== "running")
      throw new DeliveryError(
        "CONFLICT",
        "Only running deployments can finish",
      );
    const env = await environment(tx, row.environmentId);
    if (env.activeDeploymentId !== deploymentId)
      throw new DeliveryError(
        "CONFLICT",
        "Deployment no longer owns the environment",
      );
    validateFinish(input, row.versionSetRevisionId, !observesApplication(row));
    if (
      row.kind === "repair-trmnl" &&
      input.status !== "succeeded" &&
      !input.recoveryRequired
    )
      throw new DeliveryError(
        "INVALID",
        "An unsuccessful TRMNL repair must retain quarantine until independently settled",
      );
    if (input.status === "succeeded") {
      await validatePlatformSuccess(tx, row, input);
      await validateControlPlaneSuccess(tx, row);
      await validateSpecializedSuccess(tx, row);
      await acceptWorkerRetirement(tx, row);
      await acceptWorkerBaseline(tx, row);
    }
    await evidence(tx, deploymentId, input.evidence, "finish");
    const updated = await tx.deployment.update({
      where: { id: deploymentId },
      data: {
        status: input.status,
        message: input.message,
        recoveryRequired: input.recoveryRequired,
        resultFingerprint: fingerprint(input),
        finishedAt: new Date(),
      },
    });
    const suppressed = await manualSelectionBaseline.call(
      this,
      tx,
      row,
      input.status,
    );
    await tx.environment.update({
      where: { id: env.id },
      data: {
        activeDeploymentId: input.recoveryRequired ? deploymentId : null,
        ...(input.observedRevisionId === undefined
          ? {}
          : {
              observedVersionSetRevisionId: input.observedRevisionId,
              observedAt: new Date(),
            }),
        ...acceptedPointers(row, input.status),
        ...(suppressed === null
          ? {}
          : { automaticSuppressedThroughRevision: suppressed }),
      },
    });
    if (!input.recoveryRequired) {
      await tx.applicationLock.deleteMany({ where: { deploymentId } });
      await tx.platformLock.deleteMany({ where: { deploymentId } });
    }
    await audit(tx, actor, {
      action: `deployment.${input.status}`,
      entityId: deploymentId,
      requestId: id(),
    });
    return DeploymentSchema.parse(wire(updated));
  });
}

export async function manualSelectionBaseline(
  this: Delivery,
  tx: Transaction,
  row: { automatic: boolean; serviceId: string; kind: string },
  status: string,
) {
  if (
    status !== "succeeded" ||
    row.automatic ||
    [
      "adopt-worker",
      "repair-trmnl",
      "root-release",
      "tofu-plan",
      "tofu-apply",
      "upgrade-control-plane",
    ].includes(row.kind)
  )
    return null;
  await lock(tx, `qualification:${row.serviceId}`);
  const latest = await tx.versionSet.findFirst({
    where: { serviceId: row.serviceId, qualifiedBuildId: { not: null } },
    orderBy: { revision: "desc" },
  });
  return latest?.revision ?? 0;
}

export async function releaseLock(
  this: Delivery,
  ...args: [
    deploymentId: string,
    reason: string,
    actor: Principal,
    settledEvidence: EvidenceInput[],
  ]
) {
  const [deploymentId, reason, actor, settledEvidence] = args;
  if (
    !settledEvidence.some(
      (entry) =>
        entry.kind === "reconciliation" && entry.operationId !== undefined,
    )
  )
    throw new DeliveryError(
      "INVALID",
      "Recovery requires independently inspected settled external operation evidence",
    );
  return this.database.$transaction(async (tx) => {
    await lock(tx, "delivery:claim");
    const row = required(
      await tx.deployment.findUnique({ where: { id: deploymentId } }),
      "Deployment",
    );
    if (!row.recoveryRequired || !terminal.has(row.status))
      throw new DeliveryError(
        "CONFLICT",
        "Deployment does not require lock recovery",
      );
    await evidence(
      tx,
      deploymentId,
      [...settledEvidence, { kind: "preflight", summary: reason }],
      `recovery/${id()}`,
    );
    await tx.applicationLock.deleteMany({ where: { deploymentId } });
    await tx.environment.updateMany({
      where: { id: row.environmentId, activeDeploymentId: deploymentId },
      data: { activeDeploymentId: null },
    });
    const updated = await tx.deployment.update({
      where: { id: deploymentId },
      data: { recoveryRequired: false },
    });
    await audit(tx, actor, {
      action: "deployment.lock_released",
      entityId: deploymentId,
      requestId: id(),
    });
    return DeploymentSchema.parse(wire(updated));
  });
}
