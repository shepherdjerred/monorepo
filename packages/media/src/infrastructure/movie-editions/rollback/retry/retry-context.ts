import { Prisma } from "#generated/prisma/client.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { MovieRollbackRetryExpectedV1Schema } from "#shared/movie-editions/rollback/retry.ts";
import {
  captureRequestedMovieRollbackOwnerV1,
  requestedMovieRollbackConflict,
} from "#infrastructure/movie-editions/rollback/manual/manual-context.ts";
import type { readMovieRollbackIntentV1 } from "#infrastructure/movie-editions/rollback/records.ts";
import { movieRollbackPhysicalFromIntentV1 } from "#infrastructure/movie-editions/rollback/records.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { readPlexPointer } from "#infrastructure/plex-binding/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieRollbackHandoffV1 } from "./handoff-records.ts";

export type MovieRollbackRetryParentV1 = NonNullable<
  Awaited<ReturnType<typeof readMovieRollbackIntentV1>>
>;
export type MovieRollbackRetryInvocationV1 = Parameters<
  typeof captureRequestedMovieRollbackOwnerV1
>[1]["invocation"];

/** Current complete rows and current owner share the caller's original budget.
 * The returned hashes are compare-and-swap facts, never native authority. */
export async function captureMovieRollbackRetryContextV1(
  tx: Prisma.TransactionClient,
  input: {
    parent: MovieRollbackRetryParentV1;
    actorId: string;
    access: MovieChoiceAccess;
    invocation: MovieRollbackRetryInvocationV1;
  },
) {
  const { parent, invocation } = input;
  const intent = parent.intent;
  const authority = await captureRequestedMovieRollbackOwnerV1(tx, {
    actorId: input.actorId,
    scope: intent.scope,
    access: input.access,
    invocation,
  });
  const profile = await tx.qualityProfile.findUniqueOrThrow({
    where: { id: intent.authority.profileId },
  });
  invocation.budget.consume(1);
  if (profile.version !== intent.authority.profileVersion)
    throw requestedMovieRollbackConflict(
      "The admitted rollback's current profile changed",
    );
  const ids = [intent.predecessor.id, intent.successor.id].sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT a.id FROM "LibraryAsset" a WHERE a.id IN (${Prisma.join(ids)}) ORDER BY a.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT c."assetId" FROM "AssetCoverage" c WHERE c."assetId" IN (${Prisma.join(ids)}) ORDER BY c."assetId",c."mediaId",c.edition FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT s.id FROM "SubtitleAsset" s WHERE s."assetId" IN (${Prisma.join(ids)}) ORDER BY s.id FOR UPDATE`,
  );
  const predecessor = await snapshotMoviePublicationAssetV2(
    tx,
    intent.scope,
    intent.predecessor.id,
    invocation.budget,
  );
  const successor = await snapshotMoviePublicationAssetV2(
    tx,
    intent.scope,
    intent.successor.id,
    invocation.budget,
  );
  const physical = movieRollbackPhysicalFromIntentV1(parent);
  const handoff = await readMovieRollbackHandoffV1(
    tx,
    parent,
    invocation.budget,
  );
  const pointer = await readPlexPointer(
    tx,
    { mediaId: intent.scope.mediaId, edition: intent.scope.edition },
    invocation.budget,
  );
  if (
    identityHash(predecessor) !==
      identityHash(physical?.asset ?? intent.predecessor) ||
    identityHash(successor) !==
      identityHash(physical?.receipt.successor ?? intent.successor) ||
    identityHash(pointer.expected) !==
      identityHash(physical?.receipt.retiredPointer ?? intent.pointer) ||
    authority.runtime.recoveryEpoch !== intent.authority.recoveryEpoch ||
    authority.target.generation !== intent.authority.generation ||
    authority.target.profileId !== intent.authority.profileId
  )
    throw requestedMovieRollbackConflict(
      "The admitted rollback's original pair, epoch or current target changed",
    );
  await assertOriginalCleanup(tx, parent, invocation);
  const summarize = (asset: typeof predecessor) => ({
    id: asset.id,
    version: asset.version,
    checksum: asset.checksum,
    snapshotHash: identityHash(asset),
  });
  const expected = MovieRollbackRetryExpectedV1Schema.parse({
    mediaVersion: authority.media.version,
    targetVersion: authority.target.version,
    generation: authority.target.generation,
    recoveryEpoch: authority.runtime.recoveryEpoch,
    predecessor: summarize(predecessor),
    successor: summarize(successor),
    pointer: pointer.expected,
    physicalHash: physical === null ? null : identityHash(physical.receipt),
    previousHandoff: handoff?.reference ?? null,
    originalCleanup: intent.cleanup,
  });
  authority.freshness.assertActive();
  return { authority, expected, predecessor, successor, handoff };
}

async function assertOriginalCleanup(
  tx: Prisma.TransactionClient,
  parent: MovieRollbackRetryParentV1,
  invocation: MovieRollbackRetryInvocationV1,
) {
  const intent = parent.intent;
  if (intent.cleanup === null) return;
  const cleanup = await tx.upgradeCleanup.findUniqueOrThrow({
    where: { id: intent.cleanup.id },
  });
  invocation.budget.consume(1);
  if (
    cleanup.state !== "cancelled" ||
    cleanup.version !== intent.cleanup.version + 1 ||
    cleanup.expiresAt.toISOString() !== intent.cleanup.expiresAt ||
    cleanup.assetId !== intent.predecessor.id ||
    cleanup.successorAssetId !== intent.successor.id
  )
    throw requestedMovieRollbackConflict(
      "The admitted rollback's original cleanup claim changed",
    );
}
