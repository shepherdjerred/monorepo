import {
  seriesPackSealPayload,
  seriesPackSealOperationData,
  seriesPackSealOutcomeData,
} from "./seal-data.ts";
import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { MediaAttemptOperation } from "#shared/automation.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { loadSeriesPackPublicationRecordV1 } from "#infrastructure/acquisition-identity/series-pack/publication/store.ts";
import {
  loadSeriesPackPreparationsV1,
  readSeriesPackPhysicalV1,
} from "#infrastructure/acquisition-identity/series-pack/publication/receipts.ts";
import {
  SeriesPackPublicationSealInputV1Schema,
  SeriesPackPublicationOutcomeV3Schema,
} from "#shared/acquisition/series-pack-publication-v1.ts";
import {
  preparePublicationStores,
  publicationRecording,
  withPublicationPaths,
} from "#automation/publication-proof/recording.ts";
import { seriesPackPublicationContextV1 } from "./context.ts";
import { authorizeSeriesPackPublicationV1 } from "./current.ts";
import { prepareSeriesPackPublicationProofV1 } from "./proof.ts";
import { writeSeriesPackPublicationEntryV1 } from "./write-entry.ts";
import { requirePublicationExecution } from "#automation/publication-proof/invocation.ts";
import { reserveSeriesPackPublicationSqlV1 } from "./sql-budget.ts";

/** All DB publication is one transaction; immutable batch parents never stand in for write outputs. */
export async function sealSeriesPackPublicationOutcomeV1(
  initial: FileContext,
  raw: MediaAttemptOperation,
  budget: PublicationAuthorityReadBudget,
) {
  const execution = requirePublicationExecution(
    initial.publicationExecution?.(),
  );
  const fixed = { ...initial, publicationExecution: () => execution };
  const input = SeriesPackPublicationSealInputV1Schema.parse(raw);
  const parent = await loadSeriesPackPublicationRecordV1(
    initial.db,
    input.attemptId,
    budget,
  );
  if (parent === null)
    throw new FileGuardError("publication_preparation_required");
  if (
    parent.reference.intent.seriesPackPublication.coordinatorOperationId !==
    input.operationId
  )
    throw new FileGuardError("acquisition_obsolete");
  if (parent.outcome !== null) {
    if (parent.outcome.kind !== "published")
      throw new FileGuardError("series_pack_publication_compensated");
    return { status: "published" as const };
  }
  const invocation = await seriesPackPublicationContextV1(fixed, input, budget);
  const preparations = await loadSeriesPackPreparationsV1(
    initial.db,
    invocation.scope,
    budget,
  );
  if (
    identityHash(
      preparations.map((receipt) => ({
        operationId: receipt.operationId,
        batchIndex: receipt.prepared.batchIndex,
        preparedHash: receipt.preparedHash,
      })),
    ) !==
    identityHash(parent.reference.intent.seriesPackPublication.preparations)
  )
    throw new FileGuardError("series_pack_publication_preparations_changed");
  const rows = await initial.db.operation.findMany({
    where: {
      targetId: input.attemptId,
      kind: "publish_series_pack_members_v1",
    },
    take: budget.take,
  });
  budget.consume(rows.length);
  const receipts = rows
    .map((row) => readSeriesPackPhysicalV1(row))
    .sort((a, b) => a.command.batchIndex - b.command.batchIndex);
  if (
    receipts.length !== preparations.length ||
    receipts.some(
      (receipt, index) =>
        receipt.command.batchIndex !== index ||
        receipt.command.intentHash !== parent.reference.intentHash ||
        receipt.command.operationId !== input.operationId ||
        identityHash(receipt.command.entryOperationIds) !==
          identityHash(
            preparations[index]?.prepared.entries.map(
              ({ entry }) => entry.operationId,
            ),
          ),
    )
  )
    throw new FileGuardError("series_pack_publication_effects_incomplete");
  const context = await prepareSeriesPackPublicationProofV1(
    invocation.context,
    invocation.plan,
    parent.reference,
  );
  reserveSeriesPackPublicationSqlV1(budget, "complete", {
    identity: invocation.attempt.identityEvidence,
    batches: receipts.length,
  });
  const stores = await preparePublicationStores(context, {
    transitionId: parent.reference.transitionId,
    plan: invocation.plan,
  });
  const recording = publicationRecording(context, parent.reference, stores);
  const last = receipts.at(-1);
  if (
    last === undefined ||
    recording.state.next !== undefined ||
    identityHash(last.completion.effects) !== identityHash(recording.state.refs)
  )
    throw new FileGuardError("series_pack_publication_effect_prefix_changed");
  await context.db.$transaction(
    async (tx) => {
      const authority = await authorizeSeriesPackPublicationV1(
        tx,
        { ...invocation, context },
        invocation.plan,
      );
      const operations = recording.operations(() =>
        Promise.reject(
          new Error("Publication seal cannot perform forward effects"),
        ),
      );
      await withPublicationPaths(
        context,
        invocation.plan,
        operations,
        async () => {
          await recording.assertCurrent();
          // This SQL gate checks every current predecessor/caption inventory against
          // the paid immutable preparation and binds the ensuing writes to this tx.
          await tx.$queryRaw`SELECT media_series_pack_begin_commit_v1(${parent.reference.transitionId})::text`;
          const entries = [];
          for (const item of parent.reference.intent.entries) {
            const physical = receipts
              .flatMap((receipt) => receipt.completion.entries)
              .find(
                (entry) => entry.entryOperationId === item.entry.operationId,
              );
            if (physical === undefined)
              throw new FileGuardError(
                "series_pack_publication_effects_incomplete",
              );
            const written = await writeSeriesPackPublicationEntryV1(tx, {
              context,
              entry: item.entry,
              predecessor: item.predecessor,
              torrentId: authority.attempt.torrentId,
              epoch: invocation.scope.birthEpoch,
            });
            entries.push({
              entryOperationId: item.entry.operationId,
              ...written,
              participants: physical.participants,
              journals: physical.journals,
            });
          }
          const sealOperationId = crypto.randomUUID();
          const outcome = SeriesPackPublicationOutcomeV3Schema.parse({
            schemaVersion: 3,
            kind: "published",
            transitionId: parent.reference.transitionId,
            intentHash: parent.reference.intentHash,
            filePlanHash: invocation.scope.filePlanHash,
            birthEpoch: invocation.scope.birthEpoch,
            effects: recording.state.refs,
            entries,
            completedAt: new Date().toISOString(),
            seriesPackPublication: {
              schemaVersion: 1,
              sealOperationId,
              publishReceipts: receipts.map((receipt) => ({
                operationId: receipt.operationId,
                batchIndex: receipt.command.batchIndex,
                completionHash: receipt.completionHash,
              })),
            },
          });
          await tx.acquisitionAttempt.update({
            where: { id: input.attemptId },
            data: { state: "imported" },
          });
          const payload = seriesPackSealPayload(
            input,
            parent.reference.intentHash,
            outcome,
          );
          await tx.operation.create({
            data: seriesPackSealOperationData(sealOperationId, payload),
          });
          await tx.mediaPublicationTransition.update({
            where: { id: parent.reference.transitionId },
            data: seriesPackSealOutcomeData(payload),
          });
          authority.deadline.assertActive();
          await recording.assertCurrent();
          await context.checkpoint("series-pack-publication-before-commit");
        },
      );
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  return { status: "published" as const };
}
