import type { Database } from "#infrastructure/database.ts";
import type { SubtitleReplacementNetworkActivities } from "#shared/subtitle-replacement.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import { lockSubtitleReplacementScope } from "./locks.ts";
import { replacementSnapshot } from "#shared/movie-editions/subtitle-replacement-v2.ts";

export function createSubtitleReplacementNetworkActivities(
  db: Database,
): SubtitleReplacementNetworkActivities {
  return {
    async beginSubtitleReplacementReconciliation(input) {
      return serializable(db, async (tx) => {
        const initial = await tx.subtitleReplacement.findUniqueOrThrow({
          where: { id: input.replacementId },
        });
        const scope = replacementSnapshot(initial.snapshot);
        await lockSubtitleReplacementScope(tx, {
          assetId: initial.assetId,
          mediaIds: scope.asset.coverage.map((item) => item.mediaId),
          replacementId: initial.id,
          ...(scope.schemaVersion === 2 ? { movieScope: scope.scope } : {}),
        });
        const row = await tx.subtitleReplacement.findUniqueOrThrow({
          where: { id: initial.id },
        });
        const operation = await tx.operation.findUniqueOrThrow({
          where: { id: input.operationId },
        });
        if (
          row.coordinatorOperationId !== input.operationId ||
          operation.targetId !== row.id ||
          ![
            "prepare_subtitle_replacement",
            "apply_subtitle_replacement",
            "reconcile_subtitle_replacement",
          ].includes(operation.kind)
        )
          return false;
        if (!row.reservationActive) return true;
        await tx.subtitleReplacement.update({
          where: { id: row.id },
          data: { state: "reconciling", version: { increment: 1 } },
        });
        return true;
      });
    },
    async subtitleReplacementState({ replacementId }) {
      const row = await db.subtitleReplacement.findUniqueOrThrow({
        where: { id: replacementId },
        include: { receipt: true },
      });
      return {
        state: row.state,
        receiptOutcome: row.receipt?.outcome ?? null,
        cleanupState: row.cleanupState,
        archiveExpiresAt: row.archiveExpiresAt?.toISOString() ?? null,
        reservationActive: row.reservationActive,
      };
    },
    async queueSubtitleReplacementCleanup({ replacementId }) {
      await serializable(db, async (tx) => {
        const row = await tx.subtitleReplacement.findUniqueOrThrow({
          where: { id: replacementId },
          include: { receipt: true },
        });
        if (
          row.receipt === null ||
          row.reservationActive ||
          row.archiveExpiresAt === null
        )
          throw new Error(
            "Subtitle cleanup requires a settled receipt and explicit retention deadline",
          );
        const snapshot = replacementSnapshot(row.snapshot);
        await queueOperation(tx, {
          key: `subtitle-replacement-cleanup:${replacementId}`,
          kind: "cleanup_subtitle_replacement",
          targetId: replacementId,
          payload: {
            replacementId,
            recoveryEpoch: row.recoveryEpoch,
            ...(snapshot.schemaVersion === 2
              ? { movieScope: snapshot.scope }
              : {}),
          },
        });
      });
    },
  };
}
