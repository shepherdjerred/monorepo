import { Prisma } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  DeploymentSchema,
  LegacyPipelineRevisionSchema,
} from "#shared/contract.ts";
import type {
  FinishDeployment,
  Principal,
  StageInput,
} from "#shared/contract.ts";
import {
  fingerprint,
  wire,
  lock,
  required,
  audit,
  validateFinish,
} from "#infrastructure/delivery-records.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  terminal,
  id,
  environment,
  evidence,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import { acceptWorkerRetirement } from "#infrastructure/worker-pool/retirement.ts";
import { acceptWorkerBaseline } from "#infrastructure/worker-pool/baseline.ts";
import { validateSpecializedSuccess } from "#infrastructure/specialized-success.ts";
import { validatePlatformSuccess } from "#infrastructure/platform/lifecycle.ts";
import { validateControlPlaneSuccess } from "#infrastructure/control-plane/lifecycle.ts";
import { recomposeTracking } from "#infrastructure/composition/automatic.ts";
import { startMonitor } from "#infrastructure/monitor/monitor.ts";
import {
  advancesAcceptance,
  leaseExpiry,
  observesApplication,
  runningDeployment,
  type DeploymentRow,
} from "#infrastructure/execution/ownership.ts";

export async function stage(
  this: Delivery,
  deploymentId: string,
  input: StageInput,
  actor: Principal,
) {
  const leaseSeconds = await this.policy.leaseSeconds();
  return this.database.$transaction(async (tx) =>
    recordStageIn(tx, deploymentId, input, { actor, leaseSeconds }),
  );
}

/**
 * Records one stage of a running deployment inside the caller's
 * transaction, so a decision and the stage it settles commit together.
 */
export async function recordStageIn(
  tx: Transaction,
  deploymentId: string,
  input: StageInput,
  { actor, leaseSeconds }: { actor: Principal; leaseSeconds: number },
) {
  const row = await runningDeployment(
    tx,
    deploymentId,
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
    throw new DeliveryError("CONFLICT", "Completed stage cannot be rewritten");
  const { evidence: items, ...data } = input;
  const mc = /^minecraft-preservation-[1-9]\d*$/u.test(input.key)
    ? LegacyPipelineRevisionSchema.parse(
        wire(
          required(
            await tx.pipeline.findUnique({
              where: { id: row.pipelineRevisionId },
            }),
            "Pipeline",
          ),
        ),
      ).definition
    : undefined;
  const append = mc?.kind === "argocd" && mc.minecraftUpgrade !== undefined;
  const updated = await tx.stage.upsert({
    where: { deploymentId_key: { deploymentId, key: input.key } },
    create: { id: id(), deploymentId, startedAt: new Date(), ...data },
    update: data,
  });
  await evidence(
    tx,
    deploymentId,
    items,
    append ||
      (row.kind === "upgrade-control-plane" && input.key === "control-plane")
      ? { prefix: `stage/${input.key}`, appendOnly: true }
      : `stage/${input.key}`,
  );
  // A recorded stage proves the executor is alive: it renews the lease.
  await tx.deployment.update({
    where: { id: deploymentId },
    data: { leaseExpiresAt: leaseExpiry(leaseSeconds) },
  });
  await audit(tx, actor, {
    action: "deployment.stage",
    entityId: deploymentId,
    requestId: input.operationId,
    metadata: { stage: input.key, status: input.status },
  });
  return wire(updated);
}

/** Kind-specific acceptance proof and side records of a successful result. */
async function validateSuccess(
  tx: Transaction,
  row: DeploymentRow,
  input: FinishDeployment,
) {
  if (input.status !== "succeeded") return;
  await validatePlatformSuccess(tx, row, input);
  await validateControlPlaneSuccess(tx, row);
  await validateSpecializedSuccess(tx, row);
  await acceptWorkerRetirement(tx, row);
  await acceptWorkerBaseline(tx, row);
}

/** The environment after a result: ownership, observation, and on acceptance the pointer. */
function settledEnvironment(
  row: DeploymentRow,
  input: FinishDeployment,
  options: { accepted: boolean; suppressed: number | null; now: Date },
) {
  const { accepted, suppressed, now } = options;
  return {
    activeDeploymentId: input.recoveryRequired ? row.id : null,
    ...(input.observedRevisionId === undefined
      ? {}
      : {
          observedVersionSetRevisionId: input.observedRevisionId,
          observedAt: now,
        }),
    // Only acceptance moves the accepted selection and the binding
    // generation (model E1, E4, V1).
    ...(accepted
      ? {
          acceptedDeploymentId: row.id,
          generation: { increment: 1 },
          // An acceptance settles any reconcile-after-restore hold (section 6).
          restoreHold: Prisma.DbNull,
          ...(observesApplication(row)
            ? { acceptedVersionSetRevisionId: row.versionSetRevisionId }
            : {}),
        }
      : {}),
    ...(suppressed === null
      ? {}
      : { automaticSuppressedThroughRevision: suppressed }),
  };
}

function requireFinishable(row: DeploymentRow, input: FinishDeployment) {
  if (row.status !== "running")
    throw new DeliveryError("CONFLICT", "Only running deployments can finish");
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
    requireFinishable(row, input);
    const env = await environment(tx, row.environmentId);
    if (env.activeDeploymentId !== deploymentId)
      throw new DeliveryError(
        "CONFLICT",
        "Deployment no longer owns the environment",
      );
    await validateSuccess(tx, row, input);
    await evidence(tx, deploymentId, input.evidence, "finish");
    const accepted =
      input.status === "succeeded" && advancesAcceptance(row.kind);
    const now = new Date();
    const updated = await tx.deployment.update({
      where: { id: deploymentId },
      data: {
        status: input.status,
        message: input.message,
        recoveryRequired: input.recoveryRequired,
        resultFingerprint: fingerprint(input),
        finishedAt: now,
        // Acceptance starts the monitor; without a declared monitor the
        // selection settles on acceptance and is recorded as unmonitored (W1).
        ...(accepted ? await startMonitor(tx, row, now) : {}),
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
      data: settledEnvironment(row, input, { accepted, suppressed, now }),
    });
    // Services tracking a component from this environment recompose in the
    // accepting transaction (R7).
    if (accepted && observesApplication(row)) await recomposeTracking(tx, row);
    if (!input.recoveryRequired) {
      await tx.targetLock.deleteMany({ where: { deploymentId } });
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
