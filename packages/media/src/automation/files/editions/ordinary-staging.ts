import {
  OrdinaryStagingBatchSchema,
  ORDINARY_STAGING_BATCH_SIZE,
} from "#shared/acquisition/ordinary-staging.ts";
import type {
  MediaStagingInput,
  MediaStagingResult,
} from "#shared/automation.ts";
import {
  FileGuardError,
  type FileContext,
  type FilePlanEntry,
} from "#automation/files/types.ts";
import { prepareInspectionPlan } from "#automation/files/inspection.ts";
import { stageAuthorizedPlan } from "./staging.ts";
import {
  publicationDeadline,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { durablePublicationJournal } from "#filesystem/publication-proof/journal.ts";
import { safePath, verifyControlExclusion } from "#filesystem/operations-io.ts";
import { seriesPackIdentityV1 } from "#shared/acquisition/library-management.ts";

/** Journal phases schedule private work; only unchanged promotion proves whole-plan bytes. */
async function stagedPrefix(
  context: FileContext,
  plan: FilePlanEntry[],
  end: number,
) {
  for (const entry of plan.slice(0, end)) {
    const roots = context.roots[entry.libraryKind];
    await verifyControlExclusion(roots, context.verifyPlexExclusion);
    await durablePublicationJournal(roots, {
      version: 1,
      operationId: entry.operationId,
      kind: "import",
      source: await safePath(roots.downloads, entry.downloadPath, false),
      target: await safePath(roots.library, entry.libraryPath, false),
      sha256: entry.checksum,
      previousSha256: entry.previousChecksum,
      phase: "staged",
    });
  }
}

/** Each opt-in invocation retains one original SDK capability, deadline and read allowance. */
export async function inspectAndStageBatch(
  initial: FileContext,
  input: MediaStagingInput,
): Promise<MediaStagingResult> {
  const batch = OrdinaryStagingBatchSchema.parse(input.stagingBatch);
  const execution = requirePublicationExecution(
    initial.publicationExecution?.(),
  );
  const deadline = publicationDeadline(execution, execution.expiresAtMs);
  const budget =
    initial.libraryManagement?.budget ?? new PublicationAuthorityReadBudget();
  const prepared = await prepareInspectionPlan(
    {
      ...initial,
      publicationExecution: () => ({
        ...execution,
        assertActive: deadline.assertActive,
      }),
    },
    input.attemptId,
    {
      requireExisting: batch.batchIndex !== null,
      budget,
      operationId: input.operationId,
    },
  );
  if (prepared === null) return { status: "staged" };
  const { context, attempt, plan, rawFilePlan, movieAccess } = prepared;
  if (
    plan.length > 100 ||
    seriesPackIdentityV1(attempt.identityEvidence) !== null
  )
    throw new FileGuardError("staging_batch_scope_invalid");
  deadline.assertActive();
  if (batch.batchIndex === null)
    return {
      status: "staging",
      nextBatchIndex: 0,
      filePlanHash: identityHash(rawFilePlan),
    };
  if (identityHash(rawFilePlan) !== batch.filePlanHash)
    throw new FileGuardError("staging_plan_changed");
  const first = batch.batchIndex * ORDINARY_STAGING_BATCH_SIZE;
  if (first >= plan.length)
    throw new FileGuardError("staging_batch_scope_invalid");
  await stagedPrefix(context, plan, first);
  deadline.assertActive();
  await stageAuthorizedPlan(context, {
    attemptId: input.attemptId,
    mediaIds: attempt.mediaIds,
    plan,
    movieAccess,
    ordinaryBatch: {
      operationId: input.operationId,
      batchIndex: batch.batchIndex,
      filePlanHash: batch.filePlanHash,
      budget,
    },
  });
  deadline.assertActive();
  const next = first + ORDINARY_STAGING_BATCH_SIZE;
  if (next < plan.length)
    return {
      status: "staging",
      nextBatchIndex: batch.batchIndex + 1,
      filePlanHash: batch.filePlanHash,
    };
  await stagedPrefix(context, plan, plan.length);
  deadline.assertActive();
  return { status: "staged" };
}
