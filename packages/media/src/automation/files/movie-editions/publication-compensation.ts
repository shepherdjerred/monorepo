import { FileGuardError, type Transaction } from "#automation/files/types.ts";
import { assertRuntime } from "#automation/files/guards.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockPublicationRows } from "#infrastructure/publication-proof/locks.ts";
import {
  loadMoviePublicationV2,
  commitMoviePublicationOutcomeV2,
} from "#infrastructure/movie-editions/publication/store.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { MovieFilePlanV2 } from "#shared/movie-editions/file-plan-v2.ts";
import {
  MoviePublicationOutcomeV2Schema,
  type MoviePublicationIntentRefV2,
} from "#shared/movie-editions/publication-v2.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { assertPublicationUnfenced } from "#automation/publication-proof/fence.ts";
import {
  assertPublicationActive,
  type PublicationContext,
} from "#automation/publication-proof/invocation.ts";
import {
  preparePublicationStores,
  publicationRecording,
  withPublicationPaths,
} from "#automation/publication-proof/recording.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { executePublicationInverse } from "#automation/publication-proof/inverse.ts";
import { observePublicationParticipants } from "#automation/publication-proof/participants.ts";

const hash = (value: unknown) => snapshotHash(nativeJson(value));

/** Same-epoch cancellation uses the exact causal WAL inverse, independently of withdrawn request consent. */
export async function compensateMoviePublicationV2(
  context: PublicationContext,
  plan: MovieFilePlanV2,
  budget: PublicationAuthorityReadBudget,
): Promise<boolean> {
  const existing = await loadMoviePublicationV2(
    context.db,
    plan.attemptId,
    budget,
  );
  if (existing === null) return false;
  if (existing.outcome !== null) {
    if (existing.outcome.kind !== "compensated")
      throw new FileGuardError("publication_compensation_committed");
    return true;
  }
  const parent = existing.reference;
  const stores = await preparePublicationStores(context, {
    transitionId: parent.transitionId,
    plan: plan.entries,
  });
  const recording = publicationRecording(context, parent, stores, {
    inverse: { continuationId: null },
  });
  await context.db.$transaction(
    async (tx) => {
      await lockMovieCommand(tx, plan.scope);
      await assertRuntime(tx, parent.intent.birthEpoch);
      await lockPublicationRows(tx, parent.intent);
      const current = await loadMoviePublicationV2(tx, plan.attemptId, budget);
      if (
        current?.outcome !== null ||
        hash(current.reference) !== hash(parent) ||
        ["imported", "completed"].includes(current.attempt.state)
      )
        throw new FileGuardError("publication_compensation_obsolete");
      const authorize = async () => {
        await context.checkpoint("recorded-compensation-authorization");
        await assertRuntime(tx, parent.intent.birthEpoch);
        await assertPublicationUnfenced(tx, parent.intent.mediaIds, [
          plan.entries[0].assetId,
          ...(plan.entries[0].previousAssetId === null
            ? []
            : [plan.entries[0].previousAssetId]),
        ]);
        await assertUncommittedMovie(tx, parent, budget);
        assertPublicationActive(context);
      };
      const physical = await publicationAuthorityDeadline(tx, context, {
        libraryKind: "movies",
        recoveryEpoch: parent.intent.birthEpoch,
      });
      await bindPlexTransactionDeadline(tx, physical);
      for (const store of stores) store.bindAuthority(physical.assertActive);
      const operations = recording.operations(authorize);
      await withPublicationPaths(
        context,
        plan.entries,
        operations,
        async () => {
          await recording.assertCurrent();
          await authorize();
          for (const action of recording.actions) {
            const selected = operations.find(
              (item) => item.kind === action.entry.libraryKind,
            );
            if (selected === undefined)
              throw new Error("Movie compensation root executor missing");
            await executePublicationInverse(selected.files, action);
          }
          if (recording.state.next !== undefined)
            throw new FileGuardError("publication_compensation_incomplete");
          await recording.assertCurrent();
          const entry = plan.entries[0];
          const ids = [
            entry.operationId,
            `recover-${entry.assetId}`,
            ...entry.previousSidecars.flatMap((item) => [
              item.operationId,
              `recover-${item.quarantineId}`,
            ]),
          ];
          const outcome = MoviePublicationOutcomeV2Schema.parse({
            schemaVersion: 2,
            scope: plan.scope,
            kind: "compensated",
            transitionId: parent.transitionId,
            intentHash: parent.intentHash,
            filePlanHash: parent.intent.filePlanHash,
            birthEpoch: parent.intent.birthEpoch,
            effects: recording.state.refs,
            entries: [
              {
                entryOperationId: entry.operationId,
                predecessor:
                  entry.previousAssetId === null
                    ? null
                    : await snapshotMoviePublicationAssetV2(
                        tx,
                        plan.scope,
                        entry.previousAssetId,
                        budget,
                      ),
                successor: null,
                participants: await observePublicationParticipants(
                  context,
                  entry,
                ),
                journals: [...recording.state.journals.entries()]
                  .filter(([key]) =>
                    ids.some(
                      (id) =>
                        key ===
                        JSON.stringify(["movies", `journal/${id}.json`]),
                    ),
                  )
                  .map(([, value]) => value),
              },
            ],
            completedAt: new Date().toISOString(),
          });
          await commitMoviePublicationOutcomeV2(
            tx,
            { reference: parent, outcome },
            budget,
          );
          await tx.acquisitionAttempt.update({
            where: { id: plan.attemptId },
            data: {
              state: "obsolete",
              failure: { reason: "publication_compensated" },
            },
          });
          await tx.acquisitionReservation.deleteMany({
            where: { attemptId: plan.attemptId },
          });
          await context.checkpoint("publication-compensation-before-commit");
          for (const store of stores) store.assertActive();
        },
      );
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  return true;
}

async function assertUncommittedMovie(
  tx: Transaction,
  parent: MoviePublicationIntentRefV2,
  budget: PublicationAuthorityReadBudget,
) {
  const entry = parent.intent.entries[0];
  const scope = parent.intent.scope;
  if (await tx.libraryAsset.count({ where: { id: entry.entry.assetId } }))
    throw new FileGuardError("publication_compensation_committed");
  const replacement = await tx.subtitleReplacement.findFirst({
    where: {
      reservationActive: true,
      asset: { edition: scope.edition, editionRootId: scope.rootMediaId },
    },
  });
  if (replacement !== null)
    throw new FileGuardError("subtitle_replacement_unsettled");
  const coverage = await tx.assetCoverage.findMany({
    where: { mediaId: scope.mediaId, edition: scope.edition, current: true },
    take: 2,
  });
  if (
    coverage.length !== (entry.predecessor === null ? 0 : 1) ||
    coverage.some((row) => row.assetId !== entry.predecessor?.id)
  )
    throw new FileGuardError("recovery_asset_changed");
  if (entry.predecessor !== null) {
    const current = await snapshotMoviePublicationAssetV2(
      tx,
      scope,
      entry.predecessor.id,
      budget,
    );
    if (
      current.ownershipEpoch !== parent.intent.birthEpoch ||
      hash(current) !== hash(entry.predecessor)
    )
      throw new FileGuardError("recovery_asset_changed");
  }
}
