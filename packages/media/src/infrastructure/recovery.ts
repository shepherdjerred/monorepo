import { z } from "zod";
import type { Database } from "./database.ts";
import { MediaError } from "#application/errors.ts";
import { serializable } from "#automation/store.ts";

export const RecoveryInputSchema = z.object({
  recoveryId: z.uuid(),
  expectedEpoch: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500),
});
const ReceiptSchema = z.object({
  recoveryId: z.uuid(),
  previousEpoch: z.number().int(),
  recoveryEpoch: z.number().int(),
  mode: z.literal("observe"),
});

/** Run against a restored DB while ALL workers/API are stopped, before reconnect. */
export async function prepareMediaRestore(database: Database, raw: unknown) {
  const input = RecoveryInputSchema.parse(raw);
  return serializable(database, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR UPDATE`;
    const state = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    const key = `restore-observe:${input.recoveryId}`;
    const prior = await tx.operation.findUnique({
      where: { idempotencyKey: key },
    });
    if (prior !== null) {
      if (
        JSON.stringify(RecoveryInputSchema.parse(prior.payload)) !==
        JSON.stringify(input)
      )
        throw new MediaError(
          "recovery_conflict",
          "Recovery identity already has different input",
          409,
        );
      const receipt = ReceiptSchema.parse(prior.result);
      if (
        state.recoveryEpoch !== receipt.recoveryEpoch ||
        state.mode !== "observe" ||
        state.ownershipConfirmed
      )
        throw new MediaError(
          "recovery_changed",
          "Runtime changed after this recovery; use a new recovery identity",
          409,
        );
      return receipt;
    }
    if (state.recoveryEpoch !== input.expectedEpoch)
      throw new MediaError(
        "recovery_epoch_conflict",
        "Inspect the current recovery epoch before retrying",
        409,
      );
    const recoveryEpoch = state.recoveryEpoch + 1;
    await tx.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: {
        mode: "observe",
        ownershipConfirmed: false,
        recoveryEpoch,
        version: { increment: 1 },
      },
    });
    // A backup cannot prove it contains every requester or personal protection.
    // This system hold is separate from ordinary Keep/pin and survives their edits.
    await tx.$executeRaw`INSERT INTO "RecoveryHold" ("mediaId", "edition", "recoveryEpoch", "reason", "createdAt") SELECT DISTINCT coverage."mediaId", coverage."edition", ${recoveryEpoch}::integer, 'recovery_request_history_unconfirmed', NOW() FROM "AssetCoverage" coverage JOIN "LibraryAsset" asset ON asset.id = coverage."assetId" WHERE asset.owned AND asset.state <> 'purged' ON CONFLICT ("mediaId", "edition") DO UPDATE SET "recoveryEpoch" = EXCLUDED."recoveryEpoch", "reason" = EXCLUDED.reason, "createdAt" = EXCLUDED."createdAt", "releasedAt" = NULL, "releasedById" = NULL, "releaseEvidence" = NULL, "version" = "RecoveryHold"."version" + 1`;
    const receipt = {
      recoveryId: input.recoveryId,
      previousEpoch: state.recoveryEpoch,
      recoveryEpoch,
      mode: "observe" as const,
    };
    await tx.operation.create({
      data: {
        idempotencyKey: key,
        kind: "restore_observe",
        status: "completed",
        payload: input,
        result: receipt,
      },
    });
    await tx.applicationEvent.create({
      data: {
        kind: "restore_observe_prepared",
        payload: { ...receipt, reason: input.reason },
      },
    });
    return receipt;
  });
}
