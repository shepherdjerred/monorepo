import { z } from "zod";
import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { importDescriptor } from "#automation/files/inspection.ts";
import { publicationAuthorityGuard } from "#automation/publication-proof/authority.ts";
import {
  preparePublicationStores,
  publicationRecording,
  withPublicationPaths,
} from "#automation/publication-proof/recording.ts";
import { observePublicationParticipants } from "#automation/publication-proof/participants.ts";
import { loadSeriesPackPublicationRecordV1 } from "#infrastructure/acquisition-identity/series-pack/publication/store.ts";
import {
  readSeriesPackPhysicalV1,
  seriesPackPhysicalKeyV1,
} from "#infrastructure/acquisition-identity/series-pack/publication/receipts.ts";
import {
  SeriesPackPublicationInputV1Schema,
  SeriesPackPublicationCommandV1Schema,
  SeriesPackPublicationPhysicalPayloadV1Schema,
  SeriesPackPublicationPhysicalResultV1Schema,
  type SeriesPackPublicationInputV1,
  type SeriesPackPublicationBatchResultV1,
} from "#shared/acquisition/series-pack-publication-v1.ts";
import {
  seriesPackPublicationContextV1,
  seriesPackPublicationEntriesV1,
} from "./context.ts";
import {
  authorizeSeriesPackPublicationV1,
  assertSeriesPackPublicationEntryV1,
} from "./current.ts";
import { prepareSeriesPackPublicationProofV1 } from "./proof.ts";
import { reserveSeriesPackPublicationSqlV1 } from "./sql-budget.ts";

/** Forward batches write only actual files/WAL; all DB publication remains atomic at the whole seal. */
export async function publishSeriesPackMembersV1(
  initial: FileContext,
  raw: SeriesPackPublicationInputV1,
  budget: PublicationAuthorityReadBudget,
): Promise<SeriesPackPublicationBatchResultV1<"published">> {
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
  if (
    parent.reference.intent.seriesPackPublication.coordinatorOperationId !==
    input.operationId
  )
    throw new FileGuardError("acquisition_obsolete");
  const selected = seriesPackPublicationEntriesV1(
    invocation.plan,
    input.batchIndex,
  );
  const command = SeriesPackPublicationCommandV1Schema.parse({
    schemaVersion: 1,
    kind: "publish_series_pack_members_v1",
    attemptId: input.attemptId,
    operationId: input.operationId,
    transitionId: parent.reference.transitionId,
    intentHash: parent.reference.intentHash,
    batchIndex: input.batchIndex,
    entryOperationIds: selected.map((entry) => entry.operationId),
  });
  const existing = await initial.db.operation.findUnique({
    where: {
      idempotencyKey: seriesPackPhysicalKeyV1(
        input.attemptId,
        input.batchIndex,
      ),
    },
  });
  budget.consume(existing === null ? 0 : 1);
  const result = (
    receiptId: string,
  ): SeriesPackPublicationBatchResultV1<"published"> => ({
    status: "published",
    receiptId,
    nextBatchIndex:
      (input.batchIndex + 1) * 4 < invocation.plan.length
        ? input.batchIndex + 1
        : null,
  });
  if (existing !== null) {
    const receipt = readSeriesPackPhysicalV1(existing);
    if (identityHash(receipt.command) !== identityHash(command))
      throw new FileGuardError("series_pack_publication_command_changed");
    return result(receipt.operationId);
  }
  if (parent.outcome !== null)
    throw new FileGuardError("series_pack_publication_settled");
  if (input.batchIndex > 0) {
    const previous = await initial.db.operation.findUniqueOrThrow({
      where: {
        idempotencyKey: seriesPackPhysicalKeyV1(
          input.attemptId,
          input.batchIndex - 1,
        ),
      },
    });
    budget.consume(1);
    const receipt = readSeriesPackPhysicalV1(previous);
    if (
      receipt.command.intentHash !== parent.reference.intentHash ||
      receipt.command.operationId !== input.operationId
    )
      throw new FileGuardError("series_pack_publication_prefix_changed");
  }
  const context = await prepareSeriesPackPublicationProofV1(
    invocation.context,
    invocation.plan,
    parent.reference,
  );
  reserveSeriesPackPublicationSqlV1(budget, "physical", {
    identity: invocation.attempt.identityEvidence,
    batches: parent.reference.intent.seriesPackPublication.preparations.length,
    batchIndex: input.batchIndex,
  });
  const stores = await preparePublicationStores(context, {
    transitionId: parent.reference.transitionId,
    plan: invocation.plan,
  });
  const recording = publicationRecording(context, parent.reference, stores);
  const saved = await context.db.$transaction(
    async (tx) => {
      const authority = await authorizeSeriesPackPublicationV1(
        tx,
        { ...invocation, context },
        selected,
      );
      for (const store of stores) {
        const guard = await publicationAuthorityGuard(tx, context, {
          libraryKind: store.kind,
          recoveryEpoch: invocation.scope.birthEpoch,
        });
        store.bindAuthority(() => {
          authority.deadline.assertActive();
          guard();
        });
      }
      const operations = recording.operations(async (entry) => {
        if (!selected.some((item) => item.operationId === entry.operationId))
          throw new FileGuardError("series_pack_publication_batch_changed");
        authority.deadline.assertActive();
        await assertSeriesPackPublicationEntryV1(
          tx,
          context,
          authority.attempt,
          entry,
        );
      });
      return withPublicationPaths(
        context,
        invocation.plan,
        operations,
        async () => {
          await recording.assertCurrent();
          for (const entry of selected) {
            const operationsForKind = operations.find(
              (item) => item.kind === entry.libraryKind,
            );
            if (operationsForKind === undefined)
              throw new Error("Series pack publication executor missing");
            await assertSeriesPackPublicationEntryV1(
              tx,
              context,
              authority.attempt,
              entry,
            );
            for (const sidecar of entry.previousSidecars)
              await operationsForKind.files.quarantine({
                operationId: sidecar.operationId,
                libraryPath: sidecar.libraryPath,
                quarantineId: sidecar.quarantineId,
                sha256: sidecar.checksum,
              });
            await operationsForKind.files.importFile(importDescriptor(entry));
          }
          const following = invocation.plan[(input.batchIndex + 1) * 4];
          if (
            following === undefined
              ? recording.state.next !== undefined
              : recording.state.next?.entryOperationId !== following.operationId
          )
            throw new FileGuardError(
              "series_pack_publication_effects_incomplete",
            );
          await recording.assertCurrent();
          const entries = [];
          for (const entry of selected)
            entries.push({
              entryOperationId: entry.operationId,
              participants: await observePublicationParticipants(
                context,
                entry,
                true,
              ),
              journals: [...recording.state.journals.entries()]
                .filter(([key]) =>
                  [
                    entry.operationId,
                    ...entry.previousSidecars.map(
                      (sidecar) => sidecar.operationId,
                    ),
                  ].some(
                    (id) =>
                      key ===
                      JSON.stringify([entry.libraryKind, `journal/${id}.json`]),
                  ),
                )
                .map(([, journal]) => journal),
            });
          const payload = SeriesPackPublicationPhysicalPayloadV1Schema.parse({
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
          const completionResult =
            SeriesPackPublicationPhysicalResultV1Schema.parse({
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
              idempotencyKey: seriesPackPhysicalKeyV1(
                input.attemptId,
                input.batchIndex,
              ),
              payload: z.record(z.string(), z.json()).parse(payload),
              result: z.record(z.string(), z.json()).parse(completionResult),
            },
          });
          authority.deadline.assertActive();
          await context.checkpoint(
            "series-pack-publication-physical-before-commit",
          );
          for (const store of stores) store.assertActive();
          return readSeriesPackPhysicalV1(row);
        },
      );
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  return result(saved.operationId);
}
