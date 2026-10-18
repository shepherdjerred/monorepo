import { DeliveryError } from "#domain/error.ts";
import {
  PlatformReleaseSnapshotSchema,
  RecordTofuPlanSchema,
  TofuPlanReceiptSchema,
  type RecordTofuPlan,
  type Principal,
} from "#shared/contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import {
  fingerprint,
  lock,
  required,
  audit,
} from "#infrastructure/delivery-records.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { nativeReceipt } from "./policy.ts";

export async function recordTofuPlan(
  this: Delivery,
  raw: RecordTofuPlan,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const input = RecordTofuPlanSchema.parse(raw);
  const { receipt } = input;
  return this.database.$transaction(async (tx) => {
    await lock(tx, `deployment:${receipt.deploymentId}`);
    const existing = await tx.platformPlan.findUnique({
      where: { deploymentId: receipt.deploymentId },
    });
    if (existing !== null) {
      if (existing.fingerprint !== fingerprint(input))
        throw new DeliveryError(
          "CONFLICT",
          "Saved plan identity and encrypted bytes are immutable",
        );
      return TofuPlanReceiptSchema.parse(existing.receipt);
    }
    const row = required(
      await tx.deployment.findUnique({
        where: { id: receipt.deploymentId },
        include: { environment: true },
      }),
      "Plan deployment",
    );
    const snapshot = PlatformReleaseSnapshotSchema.parse(row.platformSnapshot);
    const stage = await tx.stage.findUnique({
      where: { deploymentId_key: { deploymentId: row.id, key: "tofu-plan" } },
    });
    const held = await tx.applicationLock.findUnique({
      where: { deploymentId: row.id },
    });
    if (
      row.kind !== "tofu-plan" ||
      snapshot.kind !== "tofu-plan" ||
      row.status !== "running" ||
      row.environment.activeDeploymentId !== row.id ||
      held?.application !== `tofu:${snapshot.stack}`
    )
      throw new DeliveryError(
        "CONFLICT",
        "Saved plan producer no longer owns its exact running stack deployment",
      );
    if (
      stage === null ||
      snapshot.source.id !== receipt.sourceBuildId ||
      snapshot.source.sourceRevision !== receipt.sourceRevision ||
      snapshot.stack !== receipt.stack ||
      receipt.nativeJob.requestId !== row.id ||
      fingerprint(nativeReceipt(stage.message)) !==
        fingerprint(receipt.nativeJob)
    )
      throw new DeliveryError(
        "INVALID",
        "Saved plan receipt differs from its frozen source, stack or recorded native Job identity",
      );
    const now = Date.now();
    if (
      Date.parse(receipt.createdAt) > now + 5000 ||
      now - Date.parse(receipt.createdAt) > 2 * 60 * 60 * 1000 ||
      Date.parse(receipt.expiresAt) <= now
    )
      throw new DeliveryError(
        "CONFLICT",
        "Saved plan creation or expiration is outside its execution window",
      );
    await tx.platformPlan.create({
      data: {
        deploymentId: row.id,
        receipt,
        encryptedPlan: input.encryptedPlan,
        fingerprint: fingerprint(input),
      },
    });
    await audit(tx, actor, {
      action: "platform.plan_recorded",
      entityId: row.id,
      requestId: receipt.nativeJob.uid,
      metadata: { planDigest: receipt.planDigest, stack: receipt.stack },
    });
    return receipt;
  });
}

export async function tofuPlan(
  this: Delivery,
  deploymentId: string,
  actor: Principal,
) {
  requireScope(actor, "execute");
  const row = required(
    await this.database.platformPlan.findUnique({ where: { deploymentId } }),
    "Private saved platform plan",
  );
  return RecordTofuPlanSchema.parse({
    receipt: row.receipt,
    encryptedPlan: row.encryptedPlan,
  });
}
