import { tofuStackPolicy } from "@shepherdjerred/ops-model/platform-policy.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { audit, fingerprint } from "#infrastructure/delivery-records.ts";
import {
  PlatformReleaseSnapshotSchema,
  type Principal,
} from "#shared/contract.ts";
import {
  PlatformRecoveryNativeReceiptSchema,
  RecordPlatformRecoveryPlanSchema,
  ApprovePlatformRecoveryPlanSchema,
  type PlatformRecoveryNativeReceipt,
  type RecordPlatformRecoveryPlan,
  type ApprovePlatformRecoveryPlan,
} from "#shared/platform-recovery-contract.ts";
import {
  findIntent,
  intentDetail,
  updateIntentDetail,
} from "#infrastructure/recovery-intents.ts";
import { pendingRecovery } from "./ownership.ts";
import { platformIntentView } from "./context.ts";

export async function recordPlatformRecoveryNative(
  this: Delivery,
  ...args: [string, PlatformRecoveryNativeReceipt, Principal]
) {
  const [id, raw, actor] = args;
  requireScope(actor, "execute");
  const input = PlatformRecoveryNativeReceiptSchema.parse(raw);
  return this.database.$transaction(async (tx) => {
    const { intent } = await pendingRecovery(tx, id);
    if (input.receipt.requestId !== id)
      throw new DeliveryError(
        "INVALID",
        "Recovery native Job must bind its exact intent identity",
      );
    const receipts = intent.nativeReceipts;
    if (receipts.some((entry) => fingerprint(entry) === fingerprint(input)))
      return intent;
    if (
      receipts.length >= 20 ||
      receipts.some(
        (entry) =>
          entry.receipt.name === input.receipt.name ||
          (input.action !== "inspect" && entry.action === input.action),
      )
    )
      throw new DeliveryError(
        "CONFLICT",
        "Recovery native action identity is immutable and bounded",
      );
    const row = await updateIntentDetail(tx, id, {
      nativeReceipts: [...receipts, input],
    });
    await audit(tx, actor, {
      action: "platform.recovery_native",
      entityId: id,
      requestId: input.receipt.uid,
      metadata: input,
    });
    return platformIntentView(row);
  });
}

export async function recordPlatformRecoveryPlan(
  this: Delivery,
  ...args: [string, RecordPlatformRecoveryPlan, Principal]
) {
  const [id, raw, actor] = args;
  requireScope(actor, "execute");
  const input = RecordPlatformRecoveryPlanSchema.parse(raw);
  return this.database.$transaction(async (tx) => {
    const { intent, row } = await pendingRecovery(tx, id);
    const digest = fingerprint(input);
    if (intent.planFingerprint !== null) {
      if (intent.planFingerprint !== digest)
        throw new DeliveryError(
          "CONFLICT",
          "Recovery saved plan bytes and identity are immutable",
        );
      return input.receipt;
    }
    const snapshot = PlatformReleaseSnapshotSchema.parse(row.platformSnapshot),
      receipt = input.receipt;
    const entries = intent.nativeReceipts;
    if (snapshot.kind !== "tofu-apply" && snapshot.kind !== "tofu-plan")
      throw new DeliveryError(
        "INVALID",
        "Only OpenTofu recovery has a saved plan",
      );
    if (
      receipt.recoveryIntentId !== id ||
      receipt.sourceBuildId !== snapshot.source.id ||
      receipt.sourceRevision !== snapshot.source.sourceRevision ||
      receipt.stack !== snapshot.stack ||
      !entries.some(
        (entry) =>
          entry.action === "plan" &&
          fingerprint(entry.receipt) === fingerprint(receipt.nativeJob),
      )
    )
      throw new DeliveryError(
        "INVALID",
        "Recovery plan differs from its original source, stack or checkpointed native Job",
      );
    if (
      Date.parse(receipt.createdAt) > Date.now() + 5000 ||
      Date.parse(receipt.expiresAt) <= Date.now()
    )
      throw new DeliveryError(
        "CONFLICT",
        "Recovery plan is outside its execution window",
      );
    await updateIntentDetail(tx, id, {
      planReceipt: receipt,
      encryptedPlan: input.encryptedPlan,
      planFingerprint: digest,
    });
    await audit(tx, actor, {
      action: "platform.recovery_plan",
      entityId: id,
      requestId: receipt.nativeJob.uid,
      metadata: { planDigest: receipt.planDigest, planFingerprint: digest },
    });
    return receipt;
  });
}
export async function platformRecoveryPlan(
  this: Delivery,
  id: string,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const detail = intentDetail(await findIntent(this.database, id, "platform"));
  return RecordPlatformRecoveryPlanSchema.parse({
    receipt: detail["planReceipt"],
    encryptedPlan: detail["encryptedPlan"],
  });
}
export async function approvePlatformRecoveryPlan(
  this: Delivery,
  ...args: [string, ApprovePlatformRecoveryPlan, Principal]
) {
  const [id, raw, actor] = args;
  requireScope(actor, "approve");
  const input = ApprovePlatformRecoveryPlanSchema.parse(raw);
  return this.database.$transaction(async (tx) => {
    const { intent, row } = await pendingRecovery(tx, id),
      snapshot = PlatformReleaseSnapshotSchema.parse(row.platformSnapshot);
    if (
      snapshot.kind === "root-release" ||
      tofuStackPolicy(snapshot.stack).mode !== "reviewed-plan"
    )
      throw new DeliveryError(
        "INVALID",
        "Only existing reviewed-plan stack policy requires recovery approval",
      );
    if (
      intent.planFingerprint !== input.planFingerprint ||
      intent.planReceipt === null
    )
      throw new DeliveryError(
        "CONFLICT",
        "Approval must name the exact immutable recovery plan",
      );
    const current = intent.planApproval;
    if (current !== null) {
      if (
        current.actorId !== actor.id ||
        current.planFingerprint !== input.planFingerprint ||
        current.decision !== input.decision ||
        current.reason !== input.reason
      )
        throw new DeliveryError(
          "CONFLICT",
          "Recovery plan approval is immutable",
        );
      return intent;
    }
    const approval = {
      ...input,
      actorId: actor.id,
      createdAt: new Date().toISOString(),
    };
    const updated = await updateIntentDetail(tx, id, {
      planApproval: approval,
    });
    await audit(tx, actor, {
      action: "platform.recovery_plan_approval",
      entityId: id,
      requestId: id,
      metadata: approval,
    });
    return platformIntentView(updated);
  });
}
