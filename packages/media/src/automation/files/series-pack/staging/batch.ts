import type { FileContext } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { authorizeInspection } from "#automation/files/inspection.ts";
import { stageAuthorizedPlan } from "#automation/files/editions/staging.ts";
import { libraryFileInvocation } from "#automation/acquisition-management/files.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
  assertPublicationActive,
} from "#automation/publication-proof/invocation.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  SeriesPackStagingInputV1Schema,
  type SeriesPackStagingInputV1,
  type SeriesPackStagingBatchResultV1,
  SERIES_PACK_STAGING_BATCH_SIZE_V1,
} from "#shared/acquisition/series-pack-staging-v1.ts";
import {
  seriesPackStagingMembersV1,
  assertSeriesPackStagingPlanV1,
} from "#infrastructure/acquisition-identity/series-pack/staging/scope.ts";
import {
  loadSeriesPackStagingReceiptV1,
  completeSeriesPackStagingReceiptV1,
  type SeriesPackStagingReceiptV1,
} from "#infrastructure/acquisition-identity/series-pack/staging/receipts.ts";
import { durablePublicationJournal } from "#filesystem/publication-proof/journal.ts";
import { assertSeriesPackStagingScopeCurrentV1 } from "./current.ts";
import { prepareEmbeddedContent } from "#automation/publication-proof/embedded.ts";
import { prepareContentProof } from "#automation/files/content-proof.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { retainedSeriesPackStagingScopeV1 } from "./scope.ts";
import { prepareSeriesPackStagingBatchV1 } from "./prepare.ts";

function stagedResult(
  receipt: SeriesPackStagingReceiptV1,
): SeriesPackStagingBatchResultV1 {
  const next = receipt.prepared.batchIndex + 1;
  return {
    status: "staged",
    receiptId: receipt.operationId,
    nextBatchIndex:
      next * SERIES_PACK_STAGING_BATCH_SIZE_V1 <
      receipt.prepared.scope.members.length
        ? next
        : null,
  };
}

async function completedBatchAcknowledgement(
  context: FileContext,
  input: SeriesPackStagingInputV1,
  budget: PublicationAuthorityReadBudget,
): Promise<SeriesPackStagingBatchResultV1> {
  const original = await loadSeriesPackStagingReceiptV1(
    context.db,
    input,
    budget,
  );
  if (original?.result == null)
    throw new FileGuardError("series_pack_staging_already_sealed");
  if (original.prepared.scope.operationId !== input.operationId)
    throw new FileGuardError("acquisition_obsolete");
  requirePublicationExecution(context.publicationExecution?.()).assertActive();
  return stagedResult(original);
}

/** One actual Activity and one allowance; every constituent still authorizes all original leaves. */
export async function stageSeriesPackMembersV1(
  initial: FileContext,
  raw: SeriesPackStagingInputV1,
  suppliedBudget?: PublicationAuthorityReadBudget,
): Promise<SeriesPackStagingBatchResultV1> {
  const execution = requirePublicationExecution(
    initial.publicationExecution?.(),
  );
  const budget =
    suppliedBudget ??
    initial.libraryManagement?.budget ??
    new PublicationAuthorityReadBudget();
  const input = SeriesPackStagingInputV1Schema.parse(raw);
  let receipt = await loadSeriesPackStagingReceiptV1(initial.db, input, budget);
  if (
    receipt !== null &&
    receipt.prepared.scope.operationId !== input.operationId
  )
    throw new FileGuardError("acquisition_obsolete");
  if (receipt?.result != null) {
    execution.assertActive();
    return stagedResult(receipt);
  }
  const attempt = await initial.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
    include: { release: true, torrent: true },
  });
  budget.consume(1); // Included original retained source; the current attempt is separately scope-bounded.
  if (
    attempt.filePlan !== null ||
    ["imported", "completed"].includes(attempt.state)
  )
    throw new FileGuardError("series_pack_staging_already_sealed");
  if (attempt.torrent?.owned !== true)
    throw new FileGuardError("torrent_unowned");
  const scope = await retainedSeriesPackStagingScopeV1(
    initial.db,
    { attempt, observation: attempt.torrent.observation, input, own: receipt },
    budget,
  );
  const members = seriesPackStagingMembersV1(scope, input.batchIndex);
  const context = await libraryFileInvocation(
    publicationInvocation(initial, execution),
    attempt.identityEvidence,
    budget,
  );
  if (
    await authorizeInspection(context, attempt.id, {
      mediaIds: attempt.mediaIds,
      movieAccess: undefined,
    })
  )
    return completedBatchAcknowledgement(context, input, budget);
  if (receipt === null) {
    const prepared = await prepareSeriesPackStagingBatchV1(
      context,
      {
        attempt,
        observation: attempt.torrent.observation,
        scope,
        input,
        members,
      },
      budget,
    );
    if (prepared.kind === "ack")
      return completedBatchAcknowledgement(context, input, budget);
    receipt = prepared.receipt;
  }
  if (receipt.prepared.scopeHash !== identityHash(scope))
    throw new FileGuardError("series_pack_staging_scope_changed");
  if (receipt.result !== null) return stagedResult(receipt);
  // Only the original extraction descriptors are resumed. This fresh invocation
  // hashes their real bytes before the staging effect transaction.
  const proofContext = await prepareContentProof(
    context,
    receipt.prepared.entries.flatMap((entry) =>
      entry.embeddedSubtitles.map((subtitle) => ({
        libraryKind: entry.libraryKind,
        root: "control" as const,
        path: subtitle.relativePath,
      })),
    ),
  );
  if (proofContext.contentProof === undefined)
    throw new Error("Staging extraction content proof missing");
  const preparedContext = { ...proofContext, execution: context.execution };
  await prepareEmbeddedContent(
    preparedContext,
    receipt.prepared.entries,
    proofContext.contentProof,
  );
  const exact = receipt;
  await stageAuthorizedPlan(preparedContext, {
    attemptId: attempt.id,
    mediaIds: attempt.mediaIds,
    plan: exact.prepared.entries,
    movieAccess: undefined,
    seriesPackBatch: {
      assertCurrent: async (tx, current) => {
        const torrent = await assertSeriesPackStagingScopeCurrentV1(
          tx,
          current,
          scope,
        );
        const parent = await loadSeriesPackStagingReceiptV1(tx, input, budget);
        if (
          parent?.operationId !== exact.operationId ||
          parent.preparedHash !== exact.preparedHash ||
          parent.result !== null
        )
          throw new FileGuardError("series_pack_staging_parent_changed");
        assertSeriesPackStagingPlanV1(
          current,
          torrent.observation,
          exact.prepared.entries,
        );
      },
      settle: async (tx, staged) => {
        const journals = [];
        for (const item of staged)
          journals.push(
            await durablePublicationJournal(
              context.roots[item.entry.libraryKind],
              item.manifest,
            ),
          );
        const deadline = await publicationAuthorityDeadline(tx, context, {
          libraryKind: "tv",
          recoveryEpoch: attempt.recoveryEpoch,
        });
        await bindPlexTransactionDeadline(tx, deadline);
        await completeSeriesPackStagingReceiptV1(
          tx,
          exact,
          { schemaVersion: 1, preparedHash: exact.preparedHash, journals },
          budget,
        );
        deadline.assertActive();
        assertPublicationActive(preparedContext);
      },
    },
  });
  return stagedResult(exact);
}
