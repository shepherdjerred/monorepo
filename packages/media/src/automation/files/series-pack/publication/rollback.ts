import { z } from "zod";
import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { MediaAttemptOperation } from "#shared/automation.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { loadSeriesPackPublicationRecordV1 } from "#infrastructure/acquisition-identity/series-pack/publication/store.ts";
import { readPlexRollbackAttempt } from "#infrastructure/plex-binding/rollback.ts";
import { libraryFileInvocation } from "#automation/acquisition-management/files.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { lockPublicationRows } from "#infrastructure/publication-proof/locks.ts";
import { assertAcquisition } from "#automation/files/guards.ts";
import { rollbackPromotion } from "#automation/files/rollback.ts";
import {
  captureSeriesPackRollbackPathsV1,
  assertSeriesPackRollbackVersionsV1,
} from "./rollback-paths.ts";
import { loadSeriesPackLibraryRollbackOriginsV1 } from "#infrastructure/acquisition-identity/series-pack/publication/rollback-origin.ts";

/** Failed-Plex only. Successfully served packs require an independent serving retirement protocol. */
export async function rollbackPublishedSeriesPackV1(
  initial: FileContext,
  raw: MediaAttemptOperation,
  budget: PublicationAuthorityReadBudget,
) {
  const execution = requirePublicationExecution(
    initial.publicationExecution?.(),
  );
  const input = z
    .strictObject({ operationId: z.uuid(), attemptId: z.uuid() })
    .parse(raw);
  const parent = await loadSeriesPackPublicationRecordV1(
    initial.db,
    input.attemptId,
    budget,
  );
  if (parent?.outcome?.kind !== "published")
    throw new FileGuardError("series_pack_publication_not_committed");
  if (
    parent.reference.intent.seriesPackPublication.coordinatorOperationId !==
    input.operationId
  )
    throw new FileGuardError("acquisition_obsolete");
  if (parent.attempt.state === "rolled_back") {
    budget.consume(2); // The actual attempt and literal birth Operation queried by the existing receipt reader.
    await readPlexRollbackAttempt(initial.db, input.attemptId);
    execution.assertActive();
    return { status: "rolled_back" as const };
  }
  const context = await libraryFileInvocation(
    publicationInvocation(initial, execution),
    parent.attempt.identityEvidence,
    budget,
  );
  // The existing terminal receipt producer queries each restored asset once.
  // Reserve those actual completion-parent reads before the first native effect.
  budget.consume(
    parent.reference.intent.entries.filter(
      ({ entry }) => entry.previousAssetId !== null,
    ).length,
  );
  let assertPhysicalActive = execution.assertActive;
  let restoredPaths:
    Awaited<ReturnType<typeof captureSeriesPackRollbackPathsV1>> | undefined;
  const guarded = {
    ...context,
    checkpoint: async (phase: string) => {
      assertPhysicalActive();
      await context.checkpoint(phase);
      assertPhysicalActive();
    },
  };
  await rollbackPromotion(guarded, input.attemptId, input.operationId, {
    restoredPaths: (entry) => {
      if (restoredPaths === undefined)
        throw new FileGuardError("rollback_asset_changed");
      return restoredPaths(entry);
    },
    authorize: async (tx, attempt) => {
      const current = await loadSeriesPackPublicationRecordV1(
        tx,
        input.attemptId,
        budget,
      );
      if (
        current?.reference.intentHash !== parent.reference.intentHash ||
        current.outcome?.kind !== "published" ||
        attempt.coordinatorOperationId !== input.operationId ||
        attempt.state !== "imported"
      )
        throw new FileGuardError("publication_rollback_obsolete");
      await assertAcquisition(tx, input.attemptId, {
        serverMachineId: context.serverMachineId,
        libraryManagement: context.libraryManagement,
      });
      await lockPublicationRows(tx, {
        attemptId: input.attemptId,
        mediaIds: attempt.mediaIds,
        entries: parent.reference.intent.entries,
      });
      await assertSeriesPackRollbackVersionsV1(tx, current.outcome);
      const origins = await loadSeriesPackLibraryRollbackOriginsV1(
        tx,
        {
          identity: attempt.identityEvidence,
          epoch: attempt.recoveryEpoch,
        },
        budget,
      );
      restoredPaths = await captureSeriesPackRollbackPathsV1(
        tx,
        context,
        {
          entries: current.reference.intent.entries,
          origins,
          published: current.outcome,
        },
        budget,
      );
      const assetIds = parent.reference.intent.entries.map(
        ({ entry }) => entry.assetId,
      );
      if (
        (await tx.libraryAsset.count({
          where: { id: { in: assetIds }, plexPublishedAt: { not: null } },
        })) ||
        (await tx.plexBindingCurrent.count({
          where: { evidence: { assetId: { in: assetIds } } },
        })) ||
        (await tx.plexClaimGroup.count({
          where: {
            OR: assetIds.map((assetId) => ({
              group: { path: ["assetId"], equals: assetId },
            })),
          },
        }))
      )
        throw new FileGuardError("series_pack_already_served");
      const deadline = await publicationAuthorityDeadline(tx, context, {
        libraryKind: "tv",
        recoveryEpoch: parent.reference.intent.birthEpoch,
      });
      await bindPlexTransactionDeadline(tx, deadline);
      deadline.assertActive();
      assertPhysicalActive = deadline.assertActive;
      return deadline.assertActive;
    },
  });
  execution.assertActive();
  return { status: "rolled_back" as const };
}
