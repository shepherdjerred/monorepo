import { z } from "zod";
import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { MediaAttemptOperation } from "#shared/automation.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { loadSeriesPackPublicationRecordV1 } from "#infrastructure/acquisition-identity/series-pack/publication/store.ts";
import { readSeriesPackInverseV1 } from "#infrastructure/acquisition-identity/series-pack/publication/inverse-receipts.ts";
import { readSeriesPackPhysicalV1 } from "#infrastructure/acquisition-identity/series-pack/publication/receipts.ts";
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
import { prepareSeriesPackPublicationProofV1 } from "./proof.ts";
import { authorizeSeriesPackInverseV1 } from "./inverse-current.ts";
import { requirePublicationExecution } from "#automation/publication-proof/invocation.ts";
import { reserveSeriesPackPublicationSqlV1 } from "./sql-budget.ts";

export async function sealSeriesPackCompensationV1(
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
    if (parent.outcome.kind !== "compensated")
      throw new FileGuardError("publication_compensation_committed");
    return { status: "compensated" as const };
  }
  const invocation = await seriesPackPublicationContextV1(fixed, input, budget);
  const rows = await initial.db.operation.findMany({
    where: {
      targetId: input.attemptId,
      kind: {
        in: [
          "publish_series_pack_members_v1",
          "compensate_series_pack_members_v1",
        ],
      },
    },
    take: budget.take,
  });
  budget.consume(rows.length);
  const forward = rows
    .filter((row) => row.kind === "publish_series_pack_members_v1")
    .map((row) => readSeriesPackPhysicalV1(row))
    .sort((a, b) => a.command.batchIndex - b.command.batchIndex);
  const inverse = rows
    .filter((row) => row.kind === "compensate_series_pack_members_v1")
    .map((row) => readSeriesPackInverseV1(row))
    .sort((a, b) => a.command.batchIndex - b.command.batchIndex);
  if (
    inverse.length !==
      parent.reference.intent.seriesPackPublication.preparations.length ||
    inverse.some(
      (receipt, index) =>
        receipt.command.batchIndex !== index ||
        receipt.command.intentHash !== parent.reference.intentHash ||
        receipt.command.operationId !== input.operationId,
    )
  )
    throw new FileGuardError("series_pack_compensation_incomplete");
  const context = await prepareSeriesPackPublicationProofV1(
    invocation.context,
    invocation.plan,
    parent.reference,
  );
  reserveSeriesPackPublicationSqlV1(budget, "compensated", {
    identity: invocation.attempt.identityEvidence,
    batches: inverse.length,
    forwardBatches: forward.length,
  });
  const stores = await preparePublicationStores(context, {
    transitionId: parent.reference.transitionId,
    plan: invocation.plan,
  });
  const recording = publicationRecording(context, parent.reference, stores, {
    inverse: { continuationId: null },
  });
  const last = inverse.at(-1);
  if (
    last === undefined ||
    recording.state.next !== undefined ||
    identityHash(last.completion.effects) !== identityHash(recording.state.refs)
  )
    throw new FileGuardError("series_pack_compensation_incomplete");
  await context.db.$transaction(
    async (tx) => {
      const deadline = await authorizeSeriesPackInverseV1(
        tx,
        context,
        parent.reference,
      );
      await withPublicationPaths(
        context,
        invocation.plan,
        recording.operations(() =>
          Promise.reject(new Error("Compensation seal cannot perform effects")),
        ),
        async () => {
          await recording.assertCurrent();
          await tx.$queryRaw`SELECT media_series_pack_begin_inverse_v1(${parent.reference.transitionId})::text`;
          const entries = parent.reference.intent.entries.map((item) => {
            const physical = inverse
              .flatMap((receipt) => receipt.completion.entries)
              .find(
                (entry) => entry.entryOperationId === item.entry.operationId,
              );
            if (physical === undefined)
              throw new FileGuardError("series_pack_compensation_incomplete");
            return {
              entryOperationId: item.entry.operationId,
              predecessor: item.predecessor,
              successor: null,
              participants: physical.participants,
              journals: physical.journals,
            };
          });
          const sealOperationId = crypto.randomUUID();
          const refs = (receipts: typeof forward | typeof inverse) =>
            receipts.map((receipt) => ({
              operationId: receipt.operationId,
              batchIndex: receipt.command.batchIndex,
              completionHash: receipt.completionHash,
            }));
          const outcome = SeriesPackPublicationOutcomeV3Schema.parse({
            schemaVersion: 3,
            kind: "compensated",
            transitionId: parent.reference.transitionId,
            intentHash: parent.reference.intentHash,
            filePlanHash: parent.reference.intent.filePlanHash,
            birthEpoch: parent.reference.intent.birthEpoch,
            effects: recording.state.refs,
            entries,
            completedAt: new Date().toISOString(),
            seriesPackPublication: {
              schemaVersion: 1,
              sealOperationId,
              publishReceipts: refs(forward),
              compensationReceipts: refs(inverse),
            },
          });
          await tx.acquisitionAttempt.update({
            where: { id: input.attemptId },
            data: {
              state: "obsolete",
              failure: { reason: "publication_compensated" },
            },
          });
          await tx.acquisitionReservation.deleteMany({
            where: { attemptId: input.attemptId },
          });
          const payload = {
            schemaVersion: 1,
            kind: "seal_series_pack_publication_v1",
            attemptId: input.attemptId,
            operationId: input.operationId,
            intentHash: parent.reference.intentHash,
            outcome,
            outcomeHash: identityHash(outcome),
            raw: canonicalJson(z.json().parse(outcome)),
          };
          await tx.operation.create({
            data: {
              id: sealOperationId,
              kind: payload.kind,
              targetId: input.attemptId,
              userId: null,
              status: "completed",
              idempotencyKey: `series-pack-publication-seal-v1:${input.attemptId}`,
              payload: z.record(z.string(), z.json()).parse(payload),
            },
          });
          await tx.mediaPublicationTransition.update({
            where: { id: parent.reference.transitionId },
            data: {
              outcome: z.record(z.string(), z.json()).parse(outcome),
              outcomeHash: payload.outcomeHash,
            },
          });
          deadline.assertActive();
          await context.checkpoint(
            "series-pack-compensation-seal-before-commit",
          );
        },
      );
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  return { status: "compensated" as const };
}
