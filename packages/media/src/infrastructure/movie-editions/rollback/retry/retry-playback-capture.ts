import {
  Prisma,
  type MediaIntent,
  type MediaRuntimeState,
  type QualityProfile,
} from "#generated/prisma/client.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import type { MovieRollbackHandoffExecutionV1 } from "./handoff-execution.ts";
import { captureMovieRollbackHandoffExecutionV1 } from "./handoff-execution.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { readPlexPointer } from "#infrastructure/plex-binding/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { readMovieRollbackRetryParentV1 } from "./retry-parent.ts";
import { movieRollbackPhysicalFromIntentV1 } from "#infrastructure/movie-editions/rollback/records.ts";
import { movieRollbackRetryPlaybackPathsV1 } from "./retry-paths.ts";
import type { MovieRollbackRetryParentV1 } from "./retry-context.ts";

export async function captureMovieRollbackRetryPlaybackV1(
  tx: Prisma.TransactionClient,
  input: {
    handoff: MovieRollbackHandoffExecutionV1;
    access: MovieChoiceAccess;
    invocation: MovieManagementInvocation;
  },
) {
  const { invocation, handoff } = input;
  const locked = await lockMovieCommand(tx, handoff.input.scope);
  invocation.budget.consume(locked.target === null ? 1 : 2);
  await tx.$queryRaw`SELECT o.id FROM "Operation" o WHERE o.id=${handoff.input.resume.operationId} FOR UPDATE`;
  const parent = await readMovieRollbackRetryParentV1(
    tx,
    handoff.input,
    invocation.budget,
  );
  if (movieRollbackPhysicalFromIntentV1(parent) !== null)
    return { status: "complete" as const };
  if (parent.intent.invocation.mode !== "automatic_failed_plex")
    throw new Error(
      "Automatic retry playback cannot reinterpret a manual rollback command",
    );
  const current = await captureMovieRollbackHandoffExecutionV1(
    tx,
    parent,
    input,
  );
  if (current === null)
    throw new FileGuardError("movie_rollback_owner_handoff_required");
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  invocation.budget.consume(1);
  const profile = await tx.qualityProfile.findUniqueOrThrow({
    where: { id: parent.intent.authority.profileId },
  });
  invocation.budget.consume(1);
  assertRetryPlaybackTarget({
    target: locked.target,
    runtime,
    profile,
    parent,
  });
  const ids = [parent.intent.predecessor.id, parent.intent.successor.id].sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT a.id FROM "LibraryAsset" a WHERE a.id IN (${Prisma.join(ids)}) ORDER BY a.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT s.id FROM "SubtitleAsset" s WHERE s."assetId" IN (${Prisma.join(ids)}) ORDER BY s.id FOR UPDATE`,
  );
  const predecessor = await snapshotMoviePublicationAssetV2(
    tx,
    parent.intent.scope,
    parent.intent.predecessor.id,
    invocation.budget,
  );
  const successor = await snapshotMoviePublicationAssetV2(
    tx,
    parent.intent.scope,
    parent.intent.successor.id,
    invocation.budget,
  );
  const pointer = await readPlexPointer(
    tx,
    parent.intent.pointer.scope,
    invocation.budget,
  );
  if (
    identityHash(predecessor) !== identityHash(parent.intent.predecessor) ||
    identityHash(successor) !== identityHash(parent.intent.successor) ||
    identityHash(pointer.expected) !== identityHash(parent.intent.pointer) ||
    pointer.current?.association.schemaVersion !== 2 ||
    identityHash(pointer.current.association) !==
      parent.intent.originalItem.binding.associationHash
  )
    throw new FileGuardError("movie_rollback_pair_changed");
  const writer = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  invocation.budget.consume(1);
  if (
    writer.revokedAt !== null ||
    writer.recoveryEpoch !== runtime.recoveryEpoch ||
    writer.observedAt.getTime() > Date.now()
  )
    throw new FileGuardError("runtime_protected");
  const freshness = plexBindingFreshness({
    observed: invocation.execution.observed,
    expiresAtMs: Math.min(
      current.freshness.expiresAtMs,
      writer.expiresAt.getTime(),
    ),
    guards: [invocation.execution, current.freshness],
  });
  freshness.assertActive();
  return {
    status: "captured" as const,
    parent,
    handoff: current,
    originalAssociation: pointer.current.association,
    paths: movieRollbackRetryPlaybackPathsV1(
      parent.intent,
      pointer.current.association,
    ),
    freshness,
    writerExpiresAtMs: writer.expiresAt.getTime(),
    captionCount:
      predecessor.subtitles.length +
      predecessor.subtitleHistory.length +
      successor.subtitles.length +
      successor.subtitleHistory.length,
  };
}

function assertRetryPlaybackTarget(input: {
  target: MediaIntent | null;
  runtime: MediaRuntimeState;
  profile: QualityProfile;
  parent: MovieRollbackRetryParentV1;
}) {
  const { target, runtime, profile, parent } = input;
  if (
    target?.profileId !== profile.id ||
    profile.version !== parent.intent.authority.profileVersion ||
    target.generation !== parent.intent.authority.generation ||
    target.automationEpoch !== parent.intent.authority.recoveryEpoch ||
    !target.desiredPresence ||
    !target.monitoring ||
    target.intentionallyRemovedAt !== null ||
    runtime.mode !== "active" ||
    !runtime.ownershipConfirmed ||
    runtime.recoveryEpoch !== parent.intent.authority.recoveryEpoch
  )
    throw new FileGuardError("movie_rollback_pair_changed");
}
