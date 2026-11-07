import { FileOperations } from "#filesystem/operations.ts";
import {
  prepareContentProof,
  type ContentReference,
} from "#automation/files/content-proof.ts";
import { FileGuardError, type FileContext } from "#automation/files/types.ts";
import { assertPlanEdition } from "#automation/files/editions/acquisition.ts";
import { libraryFileInvocation } from "#automation/acquisition-management/files.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
  assertPublicationActive,
} from "#automation/publication-proof/invocation.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { assertSeriesPackStagingPlanV1 } from "#infrastructure/acquisition-identity/series-pack/staging/scope.ts";
import {
  loadSeriesPackStagingSealV1,
  loadSeriesPackStagingBatchesV1,
  createSeriesPackStagingSealV1,
} from "#infrastructure/acquisition-identity/series-pack/staging/seal.ts";
import {
  SeriesPackStagingSealInputV1Schema,
  type SeriesPackStagingSealResultV1,
} from "#shared/acquisition/series-pack-staging-v1.ts";
import { authorizeSeriesPackStagingV1 } from "./current.ts";
import type { MediaAttemptOperation } from "#shared/automation.ts";
import { loadSeriesPackStagingReceiptV1 } from "#infrastructure/acquisition-identity/series-pack/staging/receipts.ts";
import {
  assertSeriesPackStagingAttemptCurrentV1,
  assertSeriesPackStagingObservationCurrentV1,
} from "#infrastructure/acquisition-identity/series-pack/staging/observation.ts";
import {
  assertSeriesPackStagedBytesV1,
  assertSeriesPackStagingJournalsV1,
} from "./seal-proof.ts";

/** All batches are real completed effects. This Activity installs only the original whole FilePlan. */
export async function sealSeriesPackStagingV1(
  initial: FileContext,
  raw: MediaAttemptOperation,
  suppliedBudget?: PublicationAuthorityReadBudget,
): Promise<SeriesPackStagingSealResultV1> {
  const execution = requirePublicationExecution(
    initial.publicationExecution?.(),
  );
  const budget =
    suppliedBudget ??
    initial.libraryManagement?.budget ??
    new PublicationAuthorityReadBudget();
  const input = SeriesPackStagingSealInputV1Schema.parse(raw);
  const existing = await loadSeriesPackStagingSealV1(
    initial.db,
    input.attemptId,
    budget,
  );
  const attempt = await initial.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
    include: { torrent: true },
  });
  if (existing !== null) {
    if (existing.seal.operationId !== input.operationId)
      throw new FileGuardError("acquisition_obsolete");
    if (existing.seal.filePlanHash !== identityHash(attempt.filePlan))
      throw new Error("Sealed original staging FilePlan changed");
    execution.assertActive();
    return { status: "staged" };
  }
  if (attempt.filePlan !== null || attempt.torrent?.owned !== true)
    throw new FileGuardError("series_pack_staging_seal_required");
  const first = await loadSeriesPackStagingReceiptV1(
    initial.db,
    { attemptId: input.attemptId, batchIndex: 0 },
    budget,
  );
  if (first?.result == null)
    throw new FileGuardError("series_pack_staging_first_batch_required");
  const scope = first.prepared.scope;
  if (scope.operationId !== input.operationId)
    throw new FileGuardError("acquisition_obsolete");
  assertSeriesPackStagingAttemptCurrentV1(attempt, scope);
  assertSeriesPackStagingObservationCurrentV1(
    scope,
    attempt.torrent.observation,
  );
  const context = await libraryFileInvocation(
    publicationInvocation(initial, execution),
    attempt.identityEvidence,
    budget,
  );
  const captured = await loadSeriesPackStagingBatchesV1(
    context.db,
    scope,
    budget,
  );
  const references: ContentReference[] = captured.plan.flatMap((entry) => [
    {
      libraryKind: entry.libraryKind,
      root: "control",
      path: `staging/${entry.operationId}`,
    },
    {
      libraryKind: entry.libraryKind,
      root: "control",
      path: `journal/${entry.operationId}.json`,
    },
    ...entry.embeddedSubtitles.map((subtitle) => ({
      libraryKind: entry.libraryKind,
      root: "control" as const,
      path: subtitle.relativePath,
    })),
  ]);
  const proofContext = await prepareContentProof(context, references);
  const contentProof = proofContext.contentProof;
  if (contentProof === undefined)
    throw new Error("Complete staging content proof missing");
  await assertSeriesPackStagingJournalsV1(context, captured.receipts);
  const files = new FileOperations(context.roots.tv, {
    contentProof,
    authorize: () => Promise.reject(new Error("Staging seal cannot publish")),
    ...(context.verifyPlexExclusion === undefined
      ? {}
      : { verifyPlexExclusion: context.verifyPlexExclusion }),
  });
  await context.db.$transaction(
    async (tx) => {
      const current = await authorizeSeriesPackStagingV1(tx, context, scope);
      if (current.attempt.filePlan !== null)
        throw new FileGuardError("series_pack_staging_already_sealed");
      const actual = await loadSeriesPackStagingBatchesV1(tx, scope, budget);
      if (identityHash(actual) !== identityHash(captured))
        throw new FileGuardError("series_pack_staging_parent_changed");
      assertSeriesPackStagingPlanV1(
        current.attempt,
        current.torrent.observation,
        actual.plan,
      );
      await assertPlanEdition(tx, current.attempt, actual.plan);
      await files.withContentPaths(
        references.map((reference) => ({
          root: reference.root,
          path: reference.path,
        })),
        async () => {
          await assertSeriesPackStagedBytesV1(context, {
            contentProof,
            plan: actual.plan,
          });
          await tx.acquisitionAttempt.update({
            where: { id: attempt.id },
            data: { filePlan: actual.plan, state: "validating" },
          });
          await createSeriesPackStagingSealV1(
            tx,
            {
              schemaVersion: 1,
              attemptId: attempt.id,
              operationId: input.operationId,
              scope,
              scopeHash: identityHash(scope),
              filePlanHash: identityHash(actual.plan),
              receipts: actual.receipts.map((receipt) => {
                if (receipt.result === null)
                  throw new Error("Staging completion disappeared");
                return {
                  operationId: receipt.operationId,
                  batchIndex: receipt.prepared.batchIndex,
                  preparedHash: receipt.preparedHash,
                  completionHash: receipt.result.completionHash,
                };
              }),
            },
            actual.plan,
            budget,
          );
          current.deadline.assertActive();
          assertPublicationActive(context);
        },
        actual.plan.map((entry) => entry.operationId),
      );
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  return { status: "staged" };
}
