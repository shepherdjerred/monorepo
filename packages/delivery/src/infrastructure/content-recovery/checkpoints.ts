import { Prisma } from "#generated/prisma/client.ts";
import { DeliveryError } from "#domain/error.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { audit, fingerprint, wire } from "#infrastructure/delivery-records.ts";
import { pendingDeliveryObservations } from "#infrastructure/delivery-data.ts";
import { holdPlatformLock } from "#infrastructure/platform/lifecycle.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import {
  ContentRecoveryIntentSchema,
  ContentRecoveryNativeReceiptSchema,
  DispatchBarrierSchema,
  type ContentRecoveryNativeReceipt,
  type DispatchBarrier,
  type Principal,
} from "#shared/contract.ts";
import { pendingContentIntent } from "./ownership.ts";
import { createHash } from "node:crypto";
import { nativeReceipt } from "#infrastructure/platform/policy.ts";

export async function recordContentRecoveryNative(
  this: Delivery,
  id: string,
  raw: ContentRecoveryNativeReceipt,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const input = ContentRecoveryNativeReceiptSchema.parse(raw);
  return this.database.$transaction(async (tx) => {
    const { intent, row, env, targetKind } = await pendingContentIntent(tx, id);
    const original = input.action === "original";
    if (input.receipt.namespace === "delivery-worker-jobs") {
      if (
        !original ||
        row.workerSnapshot === null ||
        !row.stages.some(
          (stage) =>
            fingerprint(nativeReceipt(stage.message)) ===
            fingerprint(input.receipt),
        )
      )
        throw new DeliveryError(
          "CONFLICT",
          "Original worker receipt must match an exact frozen worker-stage request and UID; content repair never creates worker Jobs",
        );
    } else {
      if (
        targetKind !== "forum" ||
        input.receipt.namespace !== env.application ||
        (original
          ? input.receipt.name !==
              `storm-forum-release-${createHash("sha256").update(row.id).digest("hex").slice(0, 32)}` ||
            input.receipt.requestId !== row.id
          : input.receipt.requestId !==
            deliveryOperationId(`${id}:${input.action}`))
      )
        throw new DeliveryError(
          "CONFLICT",
          "Native Forum receipt differs from the exact original release or fixed recovery action",
        );
    }
    const previous = intent.nativeReceipts.find(
      (entry) =>
        entry.receipt.namespace === input.receipt.namespace &&
        entry.receipt.name === input.receipt.name,
    );
    if (previous !== undefined && fingerprint(previous) !== fingerprint(input))
      throw new DeliveryError(
        "CONFLICT",
        "Native content producer UID and specification are immutable",
      );
    const receipts =
      previous === undefined
        ? [...intent.nativeReceipts, input]
        : intent.nativeReceipts;
    ContentRecoveryIntentSchema.shape.nativeReceipts.parse(receipts);
    const updated = await tx.contentRecoveryIntent.update({
      where: { id },
      data: { nativeReceipts: receipts },
    });
    await audit(tx, actor, {
      action: "content.recovery_native",
      entityId: id,
      requestId: input.receipt.requestId,
      metadata: input,
    });
    return ContentRecoveryIntentSchema.parse(wire(updated));
  });
}

export async function recordContentRecoveryBarrier(
  this: Delivery,
  id: string,
  raw: DispatchBarrier,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const input = DispatchBarrierSchema.parse(raw);
  return this.database.$transaction(async (tx) => {
    const { intent, row } = await pendingContentIntent(tx, id);
    if (
      intent.dispatchBarrier !== null &&
      fingerprint(intent.dispatchBarrier) !== fingerprint(input)
    )
      throw new DeliveryError(
        "CONFLICT",
        "Content producer barrier journal is immutable",
      );
    const other = await tx.contentRecoveryIntent.count({
      where: {
        id: { not: id },
        dispatchBarrier: { not: Prisma.DbNull },
        barrierRestoredAt: null,
      },
    });
    const running = await tx.deployment.count({
      where: { id: { not: row.id }, status: "running" },
    });
    if (
      other !== 0 ||
      running !== 0 ||
      (await pendingDeliveryObservations(tx)) !== 1
    )
      throw new DeliveryError(
        "BUSY",
        "Drain all other running releases and independent observations before stopping the shared content producer",
      );
    await holdPlatformLock(tx, row.id, false);
    const updated = await tx.contentRecoveryIntent.update({
      where: { id },
      data: { dispatchBarrier: input },
    });
    await audit(tx, actor, {
      action: "content.recovery_barrier",
      entityId: id,
      requestId: id,
      metadata: { journal: input },
    });
    return ContentRecoveryIntentSchema.parse(wire(updated));
  });
}
