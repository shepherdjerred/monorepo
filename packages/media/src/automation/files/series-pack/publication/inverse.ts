import { z } from "zod";
import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { loadSeriesPackPublicationRecordV1 } from "#infrastructure/acquisition-identity/series-pack/publication/store.ts";
import {
  readSeriesPackInverseV1,
  seriesPackInverseKeyV1,
} from "#infrastructure/acquisition-identity/series-pack/publication/inverse-receipts.ts";
import {
  SeriesPackPublicationInputV1Schema,
  SeriesPackPublicationInverseCommandV1Schema,
  SeriesPackPublicationInversePayloadV1Schema,
  SeriesPackPublicationPhysicalResultV1Schema,
  type SeriesPackPublicationInputV1,
} from "#shared/acquisition/series-pack-publication-v1.ts";
import {
  preparePublicationStores,
  publicationRecording,
  withPublicationPaths,
} from "#automation/publication-proof/recording.ts";
import { publicationAuthorityGuard } from "#automation/publication-proof/authority.ts";
import { executePublicationInverse } from "#automation/publication-proof/inverse.ts";
import { observePublicationParticipants } from "#automation/publication-proof/participants.ts";
import {
  seriesPackPublicationContextV1,
  seriesPackPublicationEntriesV1,
} from "./context.ts";
import { prepareSeriesPackPublicationProofV1 } from "./proof.ts";
import { authorizeSeriesPackInverseV1 } from "./inverse-current.ts";
import { reserveSeriesPackPublicationSqlV1 } from "./sql-budget.ts";

/** Real causal inverse, bounded to four members; no renewed acquisition consent is invented. */
export async function compensateSeriesPackMembersV1(
  initial: FileContext,
  raw: SeriesPackPublicationInputV1,
  budget: PublicationAuthorityReadBudget,
) {
  const input = SeriesPackPublicationInputV1Schema.parse(raw);
  const invocation = await seriesPackPublicationContextV1(
    initial,
    input,
    budget,
  );
  const parent = await loadSeriesPackPublicationRecordV1(
    initial.db,
    input.attemptId,
    budget,
  );
  if (parent === null)
    throw new FileGuardError("publication_preparation_required");
  if (parent.outcome !== null)
    throw new FileGuardError("series_pack_publication_settled");
  const selected = seriesPackPublicationEntriesV1(
    invocation.plan,
    input.batchIndex,
  );
  const command = SeriesPackPublicationInverseCommandV1Schema.parse({
    schemaVersion: 1,
    kind: "compensate_series_pack_members_v1",
    attemptId: input.attemptId,
    operationId: input.operationId,
    transitionId: parent.reference.transitionId,
    intentHash: parent.reference.intentHash,
    batchIndex: input.batchIndex,
    entryOperationIds: selected.map((entry) => entry.operationId),
  });
  const result = (receiptId: string) => ({
    status: "compensated" as const,
    receiptId,
    nextBatchIndex:
      (input.batchIndex + 1) * 4 < invocation.plan.length
        ? input.batchIndex + 1
        : null,
  });
  const existing = await initial.db.operation.findUnique({
    where: {
      idempotencyKey: seriesPackInverseKeyV1(input.attemptId, input.batchIndex),
    },
  });
  budget.consume(existing === null ? 0 : 1);
  if (existing !== null) {
    const receipt = readSeriesPackInverseV1(existing);
    if (identityHash(receipt.command) !== identityHash(command))
      throw new FileGuardError("series_pack_publication_command_changed");
    return result(receipt.operationId);
  }
  const context = await prepareSeriesPackPublicationProofV1(
    invocation.context,
    invocation.plan,
    parent.reference,
  );
  reserveSeriesPackPublicationSqlV1(budget, "inverse", {
    identity: invocation.attempt.identityEvidence,
    batches: parent.reference.intent.seriesPackPublication.preparations.length,
    batchIndex: input.batchIndex,
  });
  const stores = await preparePublicationStores(context, {
    transitionId: parent.reference.transitionId,
    plan: invocation.plan,
  });
  const recording = publicationRecording(context, parent.reference, stores, {
    inverse: { continuationId: null },
  });
  const receipt = await context.db.$transaction(
    async (tx) => {
      const deadline = await authorizeSeriesPackInverseV1(
        tx,
        context,
        parent.reference,
      );
      for (const store of stores) {
        const guard = await publicationAuthorityGuard(tx, context, {
          libraryKind: store.kind,
          recoveryEpoch: invocation.scope.birthEpoch,
        });
        store.bindAuthority(() => {
          deadline.assertActive();
          guard();
        });
      }
      const operations = recording.operations(async (entry) => {
        if (!selected.some((item) => item.operationId === entry.operationId))
          throw new FileGuardError("series_pack_publication_batch_changed");
        deadline.assertActive();
        await context.checkpoint(
          "series-pack-publication-inverse-authorization",
        );
      });
      return withPublicationPaths(
        context,
        invocation.plan,
        operations,
        async () => {
          await recording.assertCurrent();
          for (const action of recording.actions.filter((item) =>
            selected.some(
              (entry) => entry.operationId === item.entry.operationId,
            ),
          )) {
            const executor = operations.find(
              (item) => item.kind === action.entry.libraryKind,
            );
            if (executor === undefined)
              throw new Error("Series pack inverse executor missing");
            await executePublicationInverse(executor.files, action);
          }
          if (
            recording.state.next !== undefined &&
            selected.some(
              (entry) =>
                entry.operationId === recording.state.next?.entryOperationId,
            )
          )
            throw new FileGuardError("series_pack_compensation_incomplete");
          await recording.assertCurrent();
          const entries = [];
          for (const entry of selected)
            entries.push({
              entryOperationId: entry.operationId,
              participants: await observePublicationParticipants(
                context,
                entry,
              ),
              journals: [...recording.state.journals.entries()]
                .filter(([key]) =>
                  [
                    `recover-${entry.assetId}`,
                    ...entry.previousSidecars.map(
                      (sidecar) => `recover-${sidecar.quarantineId}`,
                    ),
                  ].some(
                    (id) =>
                      key ===
                      JSON.stringify([entry.libraryKind, `journal/${id}.json`]),
                  ),
                )
                .map(([, journal]) => journal),
            });
          const payload = SeriesPackPublicationInversePayloadV1Schema.parse({
            schemaVersion: 1,
            command,
            commandHash: identityHash(command),
            raw: canonicalJson(z.json().parse(command)),
          });
          const completion = {
            schemaVersion: 1,
            commandHash: payload.commandHash,
            effects: recording.state.refs,
            entries,
            completedAt: new Date().toISOString(),
          };
          const settled = SeriesPackPublicationPhysicalResultV1Schema.parse({
            schemaVersion: 1,
            completion,
            completionHash: identityHash(completion),
            raw: canonicalJson(z.json().parse(completion)),
          });
          const row = await tx.operation.create({
            data: {
              kind: command.kind,
              targetId: input.attemptId,
              userId: null,
              status: "completed",
              idempotencyKey: seriesPackInverseKeyV1(
                input.attemptId,
                input.batchIndex,
              ),
              payload: z.record(z.string(), z.json()).parse(payload),
              result: z.record(z.string(), z.json()).parse(settled),
            },
          });
          deadline.assertActive();
          await context.checkpoint(
            "series-pack-publication-inverse-before-commit",
          );
          return readSeriesPackInverseV1(row);
        },
      );
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  return result(receipt.operationId);
}
