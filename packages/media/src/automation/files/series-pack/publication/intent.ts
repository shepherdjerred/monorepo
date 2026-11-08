import { z } from "zod";
import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeAttempt } from "#infrastructure/native-recovery/snapshots.ts";
import { loadSeriesPackPreparationsV1 } from "#infrastructure/acquisition-identity/series-pack/publication/receipts.ts";
import { loadSeriesPackPublicationRecordV1 } from "#infrastructure/acquisition-identity/series-pack/publication/store.ts";
import {
  SeriesPackPublicationIntentV3Schema,
  SeriesPackPublicationIntentRefV3Schema,
  SeriesPackPublicationSealInputV1Schema,
} from "#shared/acquisition/series-pack-publication-v1.ts";
import type { MediaAttemptOperation } from "#shared/automation.ts";
import {
  withPublicationPaths,
  preparePublicationStores,
} from "#automation/publication-proof/recording.ts";
import { assertInitialParticipants } from "#automation/publication-proof/intent.ts";
import { observePublicationParticipants } from "#automation/publication-proof/participants.ts";
import { FileOperations } from "#filesystem/operations.ts";
import { seriesPackPublicationContextV1 } from "./context.ts";
import { authorizeSeriesPackPublicationV1 } from "./current.ts";
import { prepareSeriesPackPublicationProofV1 } from "./proof.ts";
import { reserveSeriesPackPublicationSqlV1 } from "./sql-budget.ts";

/** A whole immutable preparation seal exists before the first forward syscall. */
export async function sealSeriesPackPublicationIntentV1(
  initial: FileContext,
  raw: MediaAttemptOperation,
  budget: PublicationAuthorityReadBudget,
) {
  const input = SeriesPackPublicationSealInputV1Schema.parse(raw);
  const invocation = await seriesPackPublicationContextV1(
    initial,
    input,
    budget,
  );
  const existing = await loadSeriesPackPublicationRecordV1(
    initial.db,
    input.attemptId,
    budget,
  );
  if (existing !== null) {
    if (
      existing.reference.intent.seriesPackPublication.coordinatorOperationId !==
      input.operationId
    )
      throw new FileGuardError("acquisition_obsolete");
    return { status: "prepared" as const };
  }
  const receipts = await loadSeriesPackPreparationsV1(
    initial.db,
    invocation.scope,
    budget,
  );
  const intent = SeriesPackPublicationIntentV3Schema.parse({
    schemaVersion: 3,
    transitionId: invocation.scope.transitionId,
    attemptId: input.attemptId,
    operationId: invocation.attempt.operationId,
    birthEpoch: invocation.scope.birthEpoch,
    filePlanHash: invocation.scope.filePlanHash,
    attemptSnapshotHash: identityHash(nativeAttempt(invocation.attempt)),
    mediaIds: invocation.scope.mediaIds,
    entries: receipts.flatMap((receipt) => receipt.prepared.entries),
    seriesPackPublication: {
      schemaVersion: 1,
      coordinatorOperationId: input.operationId,
      stagingSeal: invocation.scope.stagingSeal,
      preparations: receipts.map((receipt) => ({
        operationId: receipt.operationId,
        batchIndex: receipt.prepared.batchIndex,
        preparedHash: receipt.preparedHash,
      })),
    },
  });
  const parent = SeriesPackPublicationIntentRefV3Schema.parse({
    transitionId: intent.transitionId,
    intentHash: identityHash(intent),
    intent,
  });
  const context = await prepareSeriesPackPublicationProofV1(
    invocation.context,
    invocation.plan,
    parent,
  );
  reserveSeriesPackPublicationSqlV1(budget, "intent", {
    identity: invocation.attempt.identityEvidence,
    batches: receipts.length,
  });
  const stores = await preparePublicationStores(context, {
    transitionId: intent.transitionId,
    plan: invocation.plan,
  });
  if (stores.some((store) => store.observed.records.length > 0))
    throw new FileGuardError("publication_effect_without_intent");
  await context.db.$transaction(
    async (tx) => {
      const authority = await authorizeSeriesPackPublicationV1(
        tx,
        { ...invocation, context },
        invocation.plan,
      );
      const files = new FileOperations(context.roots.tv, {
        ...(context.contentProof === undefined
          ? {}
          : { contentProof: context.contentProof }),
        authorize: () => Promise.resolve(),
        ...(context.verifyPlexExclusion === undefined
          ? {}
          : { verifyPlexExclusion: context.verifyPlexExclusion }),
      });
      await withPublicationPaths(
        context,
        invocation.plan,
        [{ kind: "tv", files }],
        async () => {
          for (const entry of invocation.plan)
            assertInitialParticipants(
              entry,
              await observePublicationParticipants(context, entry),
            );
          // SQL052 independently checks every real preparation parent, exact current
          // predecessor inventory and the complete literal FilePlan under these locks.
          await tx.mediaPublicationTransition.create({
            data: {
              id: intent.transitionId,
              attemptId: input.attemptId,
              birthEpoch: intent.birthEpoch,
              filePlanHash: intent.filePlanHash,
              intentHash: parent.intentHash,
              intent: z.record(z.string(), z.json()).parse(intent),
            },
          });
          authority.deadline.assertActive();
          await context.checkpoint(
            "series-pack-publication-intent-before-commit",
          );
        },
      );
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  return { status: "prepared" as const };
}
