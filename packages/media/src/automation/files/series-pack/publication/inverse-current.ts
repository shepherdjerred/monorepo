import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import { assertPublicationActive } from "#automation/publication-proof/invocation.ts";
import { FileGuardError } from "#automation/files/types.ts";
import {
  assertRuntime,
  assertNoMediaSubtitleReplacement,
} from "#automation/files/guards.ts";
import { recordsAuthorized } from "#infrastructure/handoff/authority.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { lockPublicationRows } from "#infrastructure/publication-proof/locks.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import type { SeriesPackPublicationIntentRefV3 } from "#shared/acquisition/series-pack-publication-v1.ts";

/** Reverting an actual uncommitted prefix needs present ownership, not renewed acquisition consent. */
export async function authorizeSeriesPackInverseV1(
  tx: Prisma.TransactionClient,
  context: PublicationContext,
  parent: SeriesPackPublicationIntentRefV3,
) {
  const intent = parent.intent;
  assertPublicationActive(context);
  await lockAcquisitionMedia(tx, intent.mediaIds);
  await assertRuntime(tx, intent.birthEpoch);
  await lockPublicationRows(tx, {
    attemptId: intent.attemptId,
    mediaIds: intent.mediaIds,
    seriesPackPublicationAttemptId: intent.attemptId,
    entries: intent.entries,
  });
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: intent.attemptId },
  });
  if (
    attempt.coordinatorOperationId !==
      intent.seriesPackPublication.coordinatorOperationId ||
    attempt.operationId !== intent.operationId ||
    attempt.recoveryEpoch !== intent.birthEpoch ||
    identityHash(attempt.filePlan) !== intent.filePlanHash ||
    ["imported", "completed"].includes(attempt.state)
  )
    throw new FileGuardError("publication_compensation_obsolete");
  if (
    !(await recordsAuthorized(tx, {
      epoch: intent.birthEpoch,
      mediaIds: intent.mediaIds,
      assetIds: intent.entries.flatMap((item) =>
        item.entry.previousAssetId === null ? [] : [item.entry.previousAssetId],
      ),
    }))
  )
    throw new FileGuardError("record_ownership_unconfirmed");
  await assertNoMediaSubtitleReplacement(tx, intent.mediaIds);
  for (const item of intent.entries) {
    if (await tx.libraryAsset.count({ where: { id: item.entry.assetId } }))
      throw new FileGuardError("publication_compensation_committed");
  }
  const deadline = await publicationAuthorityDeadline(tx, context, {
    libraryKind: "tv",
    recoveryEpoch: intent.birthEpoch,
  });
  await bindPlexTransactionDeadline(tx, deadline);
  deadline.assertActive();
  return deadline;
}
