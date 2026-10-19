import { tofuStackPolicy } from "@shepherdjerred/ops-model/platform-policy.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  audit,
  fingerprint,
  lock,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import {
  PlatformReleaseSnapshotSchema,
  type Principal,
} from "#shared/contract.ts";
import {
  CompletePlatformRecoverySchema,
  FailPlatformRecoverySchema,
  PlatformRecoveryIntentSchema,
  AdmitPlatformRecoveryApplySchema,
  type CompletePlatformRecovery,
  type AdmitPlatformRecoveryApply,
} from "#shared/platform-recovery-contract.ts";
import { pendingRecovery } from "./ownership.ts";
import { settleRecoveryTarget } from "#infrastructure/recovery-settlement.ts";
import { requireControlPlaneOwner } from "#infrastructure/control-plane/policy.ts";
import {
  platformSettlements,
  recordedPlatformJobs,
  stoppedRootPriorMatches,
} from "./context.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";

function requireRecoveryEffectOwner(delivery: Delivery, kind: string) {
  if (kind === "upgrade-control-plane")
    requireControlPlaneOwner(delivery.catalog);
  else if (delivery.catalog.catalog.platformDeliveryDelegated !== true)
    throw new DeliveryError(
      "INVALID",
      "Infrastructure effects remain with the reviewed legacy source owner",
    );
}

async function freshOwnershipProof(
  delivery: Delivery,
  input: AdmitPlatformRecoveryApply,
  intentId: string,
  admitting = false,
) {
  const context = await delivery.platformRecovery(intentId, {
    id: "internal-recovery-proof",
    kind: "machine",
    scopes: ["read"],
  });
  if (
    input.expectedEnvironmentGeneration !==
      context.intent.expectedEnvironmentGeneration ||
    input.snapshotFingerprint !== context.intent.snapshotFingerprint ||
    input.sourceWorkflow.workflowId !==
      `delivery/${context.deployment.deployment.id}`
  )
    throw new DeliveryError(
      "CONFLICT",
      "Recovery proof differs from its original Workflow or frozen ownership",
    );
  const timestamp = Date.parse(input.observedAt);
  if (timestamp < Date.now() - 60_000 || timestamp > Date.now() + 5000)
    throw new DeliveryError(
      "CONFLICT",
      "Recovery proof must complete within sixty seconds",
    );
  const previous = await delivery.database.platformRecoveryIntent.findMany({
    where: { deploymentId: context.intent.deploymentId },
  });
  const jobs = [
    ...recordedPlatformJobs(context.deployment),
    ...previous.flatMap((row) =>
      PlatformRecoveryIntentSchema.parse(wire(row)).nativeReceipts.map(
        (entry) => entry.receipt,
      ),
    ),
  ];
  const currentApply = context.intent.nativeReceipts.find(
    (entry) => entry.action === "apply",
  )?.receipt;
  if (admitting && currentApply === undefined)
    throw new DeliveryError(
      "CONFLICT",
      "Recovery apply must checkpoint its exact native producer before admission",
    );
  for (const job of jobs.filter(
    (candidate) => !admitting || candidate.uid !== currentApply?.uid,
  ))
    if (
      !input.nativeJobs.some(
        (observed) =>
          observed.uid === job.uid &&
          observed.specFingerprint === job.specFingerprint &&
          observed.name === job.name &&
          observed.requestId === job.requestId &&
          (observed.status !== "Deleted" || observed.podsAbsent),
      )
    )
      throw new DeliveryError(
        "CONFLICT",
        "Every original and recovery native Job identity must be independently settled; absence alone is not no-effect proof",
      );
  return context;
}

export async function admitPlatformRecoveryApply(
  this: Delivery,
  ...args: [string, AdmitPlatformRecoveryApply, Principal]
) {
  const [id, raw, actor] = args;
  requireScope(actor, "execute");
  const input = AdmitPlatformRecoveryApplySchema.parse(raw);
  const context = await freshOwnershipProof(this, input, id, true);
  return this.database.$transaction(async (tx) => {
    const { intent, row } = await pendingRecovery(tx, id);
    requireRecoveryEffectOwner(this, row.kind);
    if (
      fingerprint(
        PlatformRecoveryIntentSchema.parse(wire(intent)).nativeReceipts,
      ) !== fingerprint(context.intent.nativeReceipts)
    )
      throw new DeliveryError(
        "CONFLICT",
        "Recovery native checkpoints changed after inspection",
      );
    if (row.platformSnapshot !== null) {
      const snapshot = PlatformReleaseSnapshotSchema.parse(
        row.platformSnapshot,
      );
      if (snapshot.kind !== "root-release") {
        const parsed = PlatformRecoveryIntentSchema.parse(wire(intent));
        if (
          parsed.planReceipt === null ||
          parsed.planFingerprint !== input.planFingerprint ||
          Date.parse(parsed.planReceipt.expiresAt) <= Date.now()
        )
          throw new DeliveryError(
            "CONFLICT",
            "Recovery apply requires its exact unexpired saved plan",
          );
        const mode = tofuStackPolicy(snapshot.stack).mode;
        if (!["automatic", "reviewed-plan"].includes(mode))
          throw new DeliveryError(
            "INVALID",
            "This stack remains outside orchestrated recovery apply policy",
          );
        if (
          mode === "reviewed-plan" &&
          (parsed.planApproval?.decision !== "approved" ||
            parsed.planApproval.planFingerprint !== parsed.planFingerprint)
        )
          throw new DeliveryError(
            "FORBIDDEN",
            "Recovery apply requires human approval of the exact saved plan",
          );
      }
    }
    await audit(tx, actor, {
      action: "platform.recovery_apply_admitted",
      entityId: id,
      requestId: id,
      metadata: {
        observedAt: input.observedAt,
        planFingerprint: input.planFingerprint ?? null,
      },
    });
    return PlatformRecoveryIntentSchema.parse(wire(intent));
  });
}

export async function completePlatformRecovery(
  this: Delivery,
  ...args: [string, CompletePlatformRecovery, Principal]
) {
  const [id, raw, actor] = args;
  requireScope(actor, "execute");
  const input = CompletePlatformRecoverySchema.parse(raw);
  const existing = required(
    await this.database.platformRecoveryIntent.findUnique({ where: { id } }),
    "Platform recovery intent",
  );
  if (existing.status !== "pending") {
    if (
      existing.status !== "succeeded" ||
      existing.resultFingerprint !== fingerprint(input)
    )
      throw new DeliveryError("CONFLICT", "Recovery result is immutable");
    return PlatformRecoveryIntentSchema.parse(wire(existing));
  }
  const context = await freshOwnershipProof(this, input, id);
  const expected = platformSettlements(
    context.deployment,
    context.priorDeployment,
  )[input.settlement.state];
  if (expected === undefined || expected !== input.settlement.fingerprint)
    throw new DeliveryError(
      "CONFLICT",
      "Recovery target does not match an exact frozen allowed settlement",
    );
  if (input.settlement.state === "stopped") {
    const snapshot = context.deployment.deployment.platformSnapshot;
    const report = input.stoppedRoot;
    const recorded = recordedPlatformJobs(context.deployment);
    if (
      !stoppedRootPriorMatches(context.deployment, context.priorDeployment) ||
      snapshot?.kind !== "root-release" ||
      report?.requestId !==
        deliveryOperationId(
          `${context.deployment.deployment.id}:root-release`,
        ) ||
      report.revision !==
        snapshot.charts.find(({ name }) => name === "apps")?.artifact.version ||
      report.applications.filter(({ name }) => name === "apps").length !== 1 ||
      snapshot.charts.some(
        ({ name }) =>
          !report.applications.some((application) => application.name === name),
      ) ||
      new Set(report.applications.map(({ name }) => name)).size !==
        report.applications.length ||
      recorded.length !== 1 ||
      !input.nativeJobs.some(
        (job) =>
          job.uid === recorded[0]?.uid &&
          ["Complete", "Failed"].includes(job.status),
      )
    )
      throw new DeliveryError(
        "CONFLICT",
        "Stopped root recovery requires its unchanged accepted prior, complete partial-state report and terminal original native Job",
      );
  } else if (input.stoppedRoot !== undefined) {
    throw new DeliveryError(
      "CONFLICT",
      "Stopped root evidence cannot describe a different settlement",
    );
  }
  return this.database.$transaction(async (tx) => {
    const { intent, row, env } = await pendingRecovery(tx, id);
    if (
      fingerprint(
        PlatformRecoveryIntentSchema.parse(wire(intent)).nativeReceipts,
      ) !== fingerprint(context.intent.nativeReceipts)
    )
      throw new DeliveryError(
        "CONFLICT",
        "Recovery native checkpoints changed after inspection",
      );
    await settleRecoveryTarget(tx, {
      deploymentId: row.id,
      environmentId: env.id,
      expectedGeneration: env.generation,
      releaseGlobal: true,
    });
    const result = await tx.platformRecoveryIntent.update({
      where: { id },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        resultFingerprint: fingerprint(input),
        message: input.proofSummary,
      },
    });
    await audit(tx, actor, {
      action: "platform.recovery_completed",
      entityId: id,
      requestId: id,
      metadata: { proof: input },
    });
    return PlatformRecoveryIntentSchema.parse(wire(result));
  });
}
export async function failPlatformRecovery(
  this: Delivery,
  ...args: [string, string, Principal]
) {
  const [id, message, actor] = args;
  requireScope(actor, "execute");
  const input = FailPlatformRecoverySchema.parse({ message });
  return this.database.$transaction(async (tx) => {
    await lock(tx, `platform-recovery:${id}`);
    const row = required(
      await tx.platformRecoveryIntent.findUnique({ where: { id } }),
      "Platform recovery intent",
    );
    if (row.status !== "pending") {
      if (
        row.status !== "failed" ||
        row.resultFingerprint !== fingerprint(input)
      )
        throw new DeliveryError("CONFLICT", "Recovery result is immutable");
      return PlatformRecoveryIntentSchema.parse(wire(row));
    }
    const result = await tx.platformRecoveryIntent.update({
      where: { id },
      data: {
        status: "failed",
        message,
        finishedAt: new Date(),
        resultFingerprint: fingerprint(input),
      },
    });
    await audit(tx, actor, {
      action: "platform.recovery_failed",
      entityId: id,
      requestId: id,
      metadata: input,
    });
    return PlatformRecoveryIntentSchema.parse(wire(result));
  });
}
