import { DeliveryError } from "#domain/error.ts";
import { DeploymentSchema, PipelineRevisionSchema } from "#shared/contract.ts";
import { minecraftUpgradeOf } from "#shared/model/recipe-view.ts";
import {
  PLAN_APPROVAL_STAGE_KEY,
  attestationStageKey,
} from "#shared/model/stage-keys.ts";
import type {
  FinishDeployment,
  Principal,
  StageInput,
  StageRequest,
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
import { releaseDeploymentLocks } from "#infrastructure/recovery-settlement.ts";
import {
  advancesAcceptance,
  type DeploymentRow,
  leaseExpiry,
  observesApplication,
  requireFinishingExecutor,
  requireLiveLease,
  runningDeployment,
  stageWriter,
} from "#infrastructure/execution/ownership.ts";

/**
 * Stages only a decision records (4.13, H6): an approve step waits on the
 * one human decision of the saved plan. The executor's stage writes refuse
 * them, so an execute credential never records the success a gate trusts.
 */
const DECISION_STAGE_KEYS: ReadonlySet<string> = new Set([
  PLAN_APPROVAL_STAGE_KEY,
]);

/**
 * Stage keys only an operator attestation records (X13): `attestStage`, from
 * the distinct attestor identity, settles them, so an executor cannot
 * approve its own operator-run work.
 */
const ATTESTATION_STAGE_PREFIX = attestationStageKey("");

function refuseReservedStage(key: string) {
  if (DECISION_STAGE_KEYS.has(key))
    throw new DeliveryError(
      "FORBIDDEN",
      `Stage ${key} is recorded only by its decision, never by an executor`,
    );
  if (key.startsWith(ATTESTATION_STAGE_PREFIX))
    throw new DeliveryError(
      "FORBIDDEN",
      "Only an operator attestation records an attestation stage",
    );
}

export async function stage(
  this: Delivery,
  deploymentId: string,
  request: StageRequest,
  actor: Principal,
) {
  // The executor identity proves ownership; the stage is what is recorded.
  const { executor, ...input } = request;
  refuseReservedStage(input.key);
  const leaseSeconds = await this.policy.leaseSeconds();
  return this.database.$transaction(async (tx) => {
    const row = await runningDeployment(
      tx,
      deploymentId,
      "Deployment must own the target before recording stages",
    );
    const existing = await tx.stage.findUnique({
      where: { deploymentId_key: { deploymentId, key: input.key } },
    });
    const writer = stageWriter(row, executor, { existing, ...input });
    return recordStageIn(tx, deploymentId, input, {
      actor,
      leaseSeconds: writer === "owner" ? leaseSeconds : null,
    });
  });
}

/**
 * Records one stage of a running deployment inside the caller's
 * transaction, so a decision and the stage it settles commit together.
 * `leaseSeconds` is null when the writer is not the owning executor: such a
 * write proves nothing about the executor's liveness and never renews its
 * lease (D7).
 */
export async function recordStageIn(
  tx: Transaction,
  deploymentId: string,
  input: StageInput,
  { actor, leaseSeconds }: { actor: Principal; leaseSeconds: number | null },
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
  // A preservation attempt's evidence is append-only for a Minecraft
  // upgrade, whether a v1 pipeline or a model recipe's verified-restore
  // step runs the preservation controller.
  const append =
    /^minecraft-preservation-[1-9]\d*$/u.test(input.key) &&
    minecraftUpgradeOf(
      PipelineRevisionSchema.parse(
        wire(
          required(
            await tx.pipeline.findUnique({
              where: { id: row.pipelineRevisionId },
            }),
            "Pipeline",
          ),
        ),
      ).definition,
    ) !== undefined;
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
  // The owning executor's stage proves it is alive: it renews the lease.
  if (leaseSeconds !== null)
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
  request: FinishDeployment,
  actor: Principal,
) {
  // The executor identity proves ownership; the result is what is recorded.
  const { executor, ...input } = request;
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
    // D7: a lapsed lease is no longer provably owned, so it reports nothing.
    requireLiveLease(row);
    requireFinishingExecutor(row, executor);
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
    // A stopped deployment never takes its pending decision, such as a plan
    // approval whose saved plan expired undecided: the approval expires.
    if (input.status !== "succeeded")
      await tx.approval.updateMany({
        where: { deploymentId, status: "pending" },
        data: { status: "expired", decidedAt: now },
      });
    if (!input.recoveryRequired) await releaseDeploymentLocks(tx, deploymentId);
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
