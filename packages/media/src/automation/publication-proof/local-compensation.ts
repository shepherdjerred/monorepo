import type { FilePlanEntry, Transaction } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import {
  assertRuntime,
  assertNoMediaSubtitleReplacement,
} from "#automation/files/guards.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { lockPublicationRows } from "#infrastructure/publication-proof/locks.ts";
import {
  loadPublicationIntent,
  commitPublicationOutcome,
} from "#infrastructure/publication-proof/store.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import { recordsAuthorized } from "#infrastructure/handoff/authority.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { assertPublicationUnfenced } from "./fence.ts";
import {
  assertPublicationActive,
  type PublicationContext,
} from "./invocation.ts";
import {
  preparePublicationStores,
  publicationRecording,
  withPublicationPaths,
} from "./recording.ts";
import { publicationAuthorityGuard } from "./authority.ts";
import { executePublicationInverse } from "./inverse.ts";
import { observePublicationParticipants } from "./participants.ts";
import { PublicationOutcomeSchema } from "#shared/publication-proof/outcome.ts";

/** Same birth epoch only. Cross-restore authority is exclusively the owner-reviewed native continuation. */
export async function compensateRecordedPublication(
  context: PublicationContext,
  attemptId: string,
  plan: readonly FilePlanEntry[],
): Promise<boolean> {
  const intent = await loadPublicationIntent(
    context.db,
    attemptId,
    context.libraryManagement?.budget,
  );
  if (intent === null) return false;
  const settled = await context.db.mediaPublicationTransition.findUniqueOrThrow(
    { where: { id: intent.transitionId } },
  );
  if (settled.outcome !== null) {
    // loadPublicationIntent already checked the immutable raw outcome hash and parent.
    if (PublicationOutcomeSchema.parse(settled.outcome).kind !== "compensated")
      throw new FileGuardError("publication_compensation_committed");
    return true;
  }
  const stores = await preparePublicationStores(context, {
    transitionId: intent.transitionId,
    plan,
  });
  const recording = publicationRecording(context, intent, stores, {
    inverse: { continuationId: null },
  });
  await context.db.$transaction(
    async (tx) => {
      await lockAcquisitionMedia(tx, intent.intent.mediaIds);
      await assertRuntime(tx, intent.intent.birthEpoch);
      await lockPublicationRows(tx, intent.intent);
      const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      });
      if (
        attempt.recoveryEpoch !== intent.intent.birthEpoch ||
        snapshotHash(nativeJson(attempt.filePlan)) !==
          intent.intent.filePlanHash ||
        ["imported", "completed"].includes(attempt.state)
      )
        throw new FileGuardError("publication_compensation_obsolete");
      const authorize = async (entry: FilePlanEntry) => {
        await context.checkpoint("recorded-compensation-authorization");
        await assertRuntime(tx, intent.intent.birthEpoch);
        await assertPublicationUnfenced(tx, entry.mediaIds, [
          entry.assetId,
          ...(entry.previousAssetId === null ? [] : [entry.previousAssetId]),
        ]);
        await assertNoMediaSubtitleReplacement(tx, entry.mediaIds);
        await assertUncommitted(tx, entry, intent.intent.birthEpoch);
        assertPublicationActive(context);
      };
      for (const store of stores)
        store.bindAuthority(
          await publicationAuthorityGuard(tx, context, {
            libraryKind: store.kind,
            recoveryEpoch: intent.intent.birthEpoch,
          }),
        );
      const operations = recording.operations(authorize);
      await withPublicationPaths(context, plan, operations, async () => {
        await recording.assertCurrent();
        for (const entry of plan) await authorize(entry);
        for (const action of recording.actions) {
          const item = operations.find(
            ({ kind }) => kind === action.entry.libraryKind,
          );
          if (item === undefined)
            throw new Error("Compensation root executor missing");
          await executePublicationInverse(item.files, action);
        }
        if (recording.state.next !== undefined)
          throw new FileGuardError("publication_compensation_incomplete");
        await recording.assertCurrent();
        const entries = [];
        for (const entry of plan)
          entries.push({
            entryOperationId: entry.operationId,
            predecessor:
              entry.previousAssetId === null
                ? null
                : await snapshotPublicationAsset(
                    tx,
                    entry.previousAssetId,
                    context.libraryManagement?.budget,
                  ),
            successor: null,
            participants: await observePublicationParticipants(context, entry),
            journals: [...recording.state.journals.entries()]
              .filter(([key]) =>
                [
                  entry.operationId,
                  `recover-${entry.assetId}`,
                  ...entry.previousSidecars.flatMap((item) => [
                    item.operationId,
                    `recover-${item.quarantineId}`,
                  ]),
                ].some(
                  (id) =>
                    key ===
                    JSON.stringify([entry.libraryKind, `journal/${id}.json`]),
                ),
              )
              .map(([, value]) => value),
          });
        await commitPublicationOutcome(
          tx,
          {
            intent,
            outcome: {
              schemaVersion: 1,
              kind: "compensated",
              transitionId: intent.transitionId,
              intentHash: intent.intentHash,
              filePlanHash: intent.intent.filePlanHash,
              birthEpoch: intent.intent.birthEpoch,
              effects: recording.state.refs,
              entries,
              completedAt: new Date().toISOString(),
            },
          },
          context.libraryManagement?.budget,
        );
        await tx.acquisitionAttempt.update({
          where: { id: attemptId },
          data: {
            state: "obsolete",
            failure: { reason: "publication_compensated" },
          },
        });
        await tx.acquisitionReservation.deleteMany({ where: { attemptId } });
        await context.checkpoint("publication-compensation-before-commit");
        for (const store of stores) store.assertActive();
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  return true;
}

async function assertUncommitted(
  tx: Transaction,
  entry: FilePlanEntry,
  epoch: number,
) {
  if (await tx.libraryAsset.count({ where: { id: entry.assetId } }))
    throw new FileGuardError("publication_compensation_committed");
  if (
    !(await recordsAuthorized(tx, {
      epoch,
      mediaIds: entry.mediaIds,
      assetIds: entry.previousAssetId === null ? [] : [entry.previousAssetId],
    }))
  )
    throw new FileGuardError("record_ownership_unconfirmed");
  const coverage = await tx.assetCoverage.findMany({
    where: {
      mediaId: { in: entry.mediaIds },
      edition: "default",
      current: true,
    },
  });
  if (coverage.some((row) => row.assetId !== entry.previousAssetId))
    throw new FileGuardError("recovery_asset_changed");
  if (entry.previousAssetId !== null) {
    const asset = await tx.libraryAsset.findUniqueOrThrow({
      where: { id: entry.previousAssetId },
    });
    if (
      asset.version !== entry.previousVersion ||
      asset.checksum !== entry.previousChecksum ||
      asset.state !== "published"
    )
      throw new FileGuardError("recovery_asset_changed");
  }
}
