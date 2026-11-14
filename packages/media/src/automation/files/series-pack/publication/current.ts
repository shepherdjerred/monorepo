import type { AcquisitionAttempt, Prisma } from "#generated/prisma/client.ts";
import type { FilePlanEntry } from "#automation/files/types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { assertAcquisition } from "#automation/files/guards.ts";
import { assertPrevious } from "#automation/files/publication.ts";
import {
  assertMeasuredUpgrade,
  assertProfile,
  storedMeasuredRelease,
} from "#automation/files/quality-guide/guard.ts";
import {
  assertPublicationActive,
  type PublicationContext,
} from "#automation/publication-proof/invocation.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { lockPublicationRows } from "#infrastructure/publication-proof/locks.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { assertSeriesPackStagingScopeCurrentV1 } from "#automation/files/series-pack/staging/current.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import type { seriesPackPublicationContextV1 } from "./context.ts";

export async function assertSeriesPackPublicationEntryV1(
  tx: Prisma.TransactionClient,
  context: PublicationContext,
  attempt: AcquisitionAttempt,
  entry: FilePlanEntry,
) {
  await context.checkpoint("series-pack-publication-authorization");
  if (!(await context.enabled.acquisition()))
    throw new FileGuardError("acquisition_disabled");
  await assertProfile(tx, entry);
  await assertPrevious(tx, entry, attempt.recoveryEpoch);
  await assertMeasuredUpgrade(
    tx,
    storedMeasuredRelease(entry.properties),
    entry.mediaIds,
    entry.assetId,
  );
  assertPublicationActive(context);
}

/**
 * Every Activity reacquires all original canonical/intent/request/claim/runtime
 * authority, then all planned asset/coverage/caption rows. Only immutable paid
 * parents survive calls; no current snapshot crosses a transaction boundary.
 */
export async function authorizeSeriesPackPublicationV1(
  tx: Prisma.TransactionClient,
  invocation: Awaited<ReturnType<typeof seriesPackPublicationContextV1>>,
  entries: readonly FilePlanEntry[],
) {
  const { context, scope, staging } = invocation;
  assertPublicationActive(context);
  await lockAcquisitionMedia(tx, scope.mediaIds);
  if (!(await context.enabled.acquisition()))
    throw new FileGuardError("acquisition_disabled");
  await assertAcquisition(tx, scope.attemptId, {
    serverMachineId: context.serverMachineId,
    libraryManagement: context.libraryManagement,
    seriesPackPublicationAttemptId: scope.attemptId,
  });
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: scope.attemptId },
  });
  if (
    attempt.coordinatorOperationId !== scope.operationId ||
    attempt.recoveryEpoch !== scope.birthEpoch ||
    identityHash(attempt.filePlan) !== scope.filePlanHash ||
    ["imported", "completed"].includes(attempt.state)
  )
    throw new FileGuardError("acquisition_obsolete");
  await assertSeriesPackStagingScopeCurrentV1(tx, attempt, staging.seal.scope);
  await lockPublicationRows(tx, {
    attemptId: attempt.id,
    mediaIds: attempt.mediaIds,
    seriesPackPublicationAttemptId: scope.attemptId,
    entries: invocation.plan.map((entry) => ({ entry })),
  });
  for (const entry of entries)
    await assertSeriesPackPublicationEntryV1(tx, context, attempt, entry);
  const deadline = await publicationAuthorityDeadline(tx, context, {
    libraryKind: "tv",
    recoveryEpoch: scope.birthEpoch,
  });
  await bindPlexTransactionDeadline(tx, deadline);
  deadline.assertActive();
  return { attempt, deadline };
}
