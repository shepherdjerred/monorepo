import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { FileOperations } from "#filesystem/operations.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { prepareRecordedPublicationProof } from "#automation/publication-proof/embedded.ts";
import { withPublicationPaths } from "#automation/publication-proof/recording.ts";
import { captureEntry } from "#automation/publication-proof/intent.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { lockPublicationSnapshots } from "#infrastructure/publication-proof/locked-snapshots.ts";
import {
  SeriesPackPublicationInputV1Schema,
  SeriesPackPublicationPreparedV1Schema,
  type SeriesPackPublicationInputV1,
  type SeriesPackPublicationBatchResultV1,
} from "#shared/acquisition/series-pack-publication-v1.ts";
import {
  readSeriesPackPreparationV1,
  seriesPackPreparationKeyV1,
  createSeriesPackPreparationV1,
} from "#infrastructure/acquisition-identity/series-pack/publication/receipts.ts";
import {
  seriesPackPublicationContextV1,
  seriesPackPublicationEntriesV1,
} from "./context.ts";
import { authorizeSeriesPackPublicationV1 } from "./current.ts";
import { reserveSeriesPackPublicationSqlV1 } from "./sql-budget.ts";

/** Four real snapshots per invocation; preparation is durable but grants no forward IO. */
export async function prepareSeriesPackMembersPublicationV1(
  initial: FileContext,
  raw: SeriesPackPublicationInputV1,
  budget: PublicationAuthorityReadBudget,
): Promise<SeriesPackPublicationBatchResultV1<"prepared">> {
  const input = SeriesPackPublicationInputV1Schema.parse(raw);
  const invocation = await seriesPackPublicationContextV1(
    initial,
    input,
    budget,
  );
  const selected = seriesPackPublicationEntriesV1(
    invocation.plan,
    input.batchIndex,
  );
  const previous = await initial.db.operation.findUnique({
    where: {
      idempotencyKey: seriesPackPreparationKeyV1(
        input.attemptId,
        input.batchIndex,
      ),
    },
  });
  budget.consume(previous === null ? 0 : 1);
  const next = input.batchIndex + 1;
  const result = (
    receiptId: string,
  ): SeriesPackPublicationBatchResultV1<"prepared"> => ({
    status: "prepared",
    receiptId,
    nextBatchIndex: next * 4 < invocation.plan.length ? next : null,
  });
  if (previous !== null) {
    const receipt = readSeriesPackPreparationV1(previous);
    if (identityHash(receipt.prepared.scope) !== identityHash(invocation.scope))
      throw new FileGuardError("series_pack_publication_scope_changed");
    return result(receipt.operationId);
  }
  const context = await prepareRecordedPublicationProof(
    invocation.context,
    selected,
    input.attemptId,
  );
  reserveSeriesPackPublicationSqlV1(budget, "prepare", {
    identity: invocation.attempt.identityEvidence,
    batches: Math.ceil(invocation.plan.length / 4),
  });
  const receipt = await context.db.$transaction(
    async (tx) => {
      const authority = await authorizeSeriesPackPublicationV1(
        tx,
        { ...invocation, context },
        selected,
      );
      const snapshots = await lockPublicationSnapshots(
        tx,
        {
          attemptId: input.attemptId,
          mediaIds: invocation.scope.mediaIds,
          entries: invocation.plan.map((entry) => ({ entry })),
        },
        budget,
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
      return withPublicationPaths(
        context,
        selected,
        [{ kind: "tv", files }],
        async () => {
          const entries = [];
          for (const entry of selected)
            entries.push(await captureEntry(tx, context, entry, snapshots));
          const prepared = SeriesPackPublicationPreparedV1Schema.parse({
            schemaVersion: 1,
            scope: invocation.scope,
            scopeHash: identityHash(invocation.scope),
            batchIndex: input.batchIndex,
            entries,
          });
          const saved = await createSeriesPackPreparationV1(
            tx,
            prepared,
            authority.attempt.filePlan,
          );
          authority.deadline.assertActive();
          await context.checkpoint(
            "series-pack-publication-preparation-before-commit",
          );
          return saved;
        },
      );
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  return result(receipt.operationId);
}
