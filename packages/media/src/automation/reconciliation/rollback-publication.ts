import { z } from "zod";
import { requireActiveRuntime } from "#automation/runtime.ts";
import { serializable } from "#automation/store.ts";
import { lockMedia } from "#infrastructure/locks.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type {
  MediaAttemptOperation,
  MediaNetworkActivities,
} from "#shared/automation.ts";

const ReceiptSchema = z.object({
  rollbackReceipt: z.object({
    recoveryEpoch: z.number().int(),
    mediaIds: z.array(z.string()),
    assets: z.array(
      z.object({
        assetId: z.string(),
        assetVersion: z.number().int(),
        checksum: z.string(),
      }),
    ),
  }),
});

export type RollbackPublicationProof = {
  epoch: number;
  receipt: z.infer<typeof ReceiptSchema>["rollbackReceipt"];
  requiredGenerations: Record<string, number>;
  releaseAttemptId: string;
};

export async function publishRollback(
  context: MediaAutomationContext,
  input: MediaAttemptOperation,
  publish: (
    mediaIds: string[],
    proof: RollbackPublicationProof,
  ) => ReturnType<MediaNetworkActivities["publishMediaToPlex"]>,
): ReturnType<MediaNetworkActivities["publishRolledBackMedia"]> {
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  if (attempt.state !== "rolled_back")
    return { status: "not_applicable", reason: null };
  const receipt = ReceiptSchema.parse(attempt.failure).rollbackReceipt;
  if (
    receipt.recoveryEpoch !== attempt.recoveryEpoch ||
    receipt.mediaIds.some((id) => !attempt.mediaIds.includes(id))
  )
    return { status: "blocked", reason: "rollback_receipt_invalid" };
  const runtime = await requireActiveRuntime(context.db);
  if (!runtime.active || runtime.epoch !== attempt.recoveryEpoch)
    return { status: "blocked", reason: "recovery_epoch_changed" };
  if (receipt.mediaIds.length === 0) {
    await releaseCompensatedReservation(context, attempt.id);
    return { status: "blocked", reason: "rollback_no_previous_version" };
  }
  return await publish(receipt.mediaIds, {
    epoch: attempt.recoveryEpoch,
    receipt,
    requiredGenerations: z
      .record(z.string(), z.number().int())
      .parse(attempt.generations),
    releaseAttemptId: attempt.id,
  });
}

/** Reconcile a terminal receipt left by an interrupted coordinator. */
async function releaseCompensatedReservation(
  context: MediaAutomationContext,
  attemptId: string,
): Promise<void> {
  const snapshot = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  await serializable(context.db, async (tx) => {
    await lockMedia(tx, snapshot.mediaIds);
    await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
    const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    const receipt = ReceiptSchema.parse(attempt.failure).rollbackReceipt;
    if (
      runtime.mode !== "active" ||
      !runtime.ownershipConfirmed ||
      runtime.recoveryEpoch !== attempt.recoveryEpoch ||
      attempt.state !== "rolled_back" ||
      receipt.recoveryEpoch !== attempt.recoveryEpoch ||
      receipt.mediaIds.length > 0 ||
      receipt.assets.length > 0
    )
      throw new Error("Compensated rollback authority changed");
    const entries = z
      .array(
        z.object({
          assetId: z.string(),
          checksum: z.string(),
          previousAssetId: z.null(),
        }),
      )
      .min(1)
      .parse(attempt.filePlan);
    const assets = await tx.libraryAsset.findMany({
      where: { id: { in: entries.map((entry) => entry.assetId) } },
      include: { coverage: true },
    });
    if (
      assets.length !== entries.length ||
      entries.some(
        (entry) =>
          !assets.some(
            (asset) =>
              asset.id === entry.assetId &&
              asset.owned &&
              asset.state === "rejected" &&
              asset.checksum === entry.checksum &&
              asset.coverage.every((coverage) => !coverage.current),
          ),
      )
    )
      throw new Error("Rollback compensation evidence changed");
    await tx.acquisitionReservation.deleteMany({ where: { attemptId } });
  });
}
