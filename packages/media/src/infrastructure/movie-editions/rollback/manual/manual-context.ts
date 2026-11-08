import { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { MovieRollbackContextV1Schema } from "#shared/movie-editions/rollback/manual-command.ts";
import type { MoviePublicationAssetV2 } from "#shared/movie-editions/publication-v2.ts";
import { MediaError } from "#application/errors.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import {
  movieChoiceSubject,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import type { MovieManagementInvocation } from "#infrastructure/movie-editions/management/invocation.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { loadMoviePublicationV2 } from "#infrastructure/movie-editions/publication/records.ts";
import { findMoviePublicationReferenceV2 } from "#infrastructure/movie-editions/publication/store.ts";
import { readMoviePlexReceiptV2 } from "#infrastructure/movie-editions/plex/receipt.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

export type RequestedMovieRollbackInvocationV1 = {
  budget: MovieManagementInvocation["budget"];
  execution: Pick<
    MovieManagementInvocation["execution"],
    "observed" | "expiresAtMs" | "assertActive"
  >;
};

export function requestedMovieRollbackConflict(message: string) {
  return new MediaError("movie_rollback_changed", message, 409);
}

/** New owner consent is independent of the original B requester's current choice. */
export async function captureRequestedMovieRollbackOwnerV1(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    scope: MovieEditionScope;
    access: MovieChoiceAccess;
    invocation: RequestedMovieRollbackInvocationV1;
    expected?: {
      mediaVersion: number;
      targetVersion: number;
      generation: number;
      recoveryEpoch: number;
    };
    phase?: "admission" | "physical" | "rebind";
  },
) {
  input.invocation.execution.assertActive();
  const budget = input.invocation.budget;
  const { media, target } = await lockMovieCommand(tx, input.scope);
  budget.consume(target === null ? 1 : 2);
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  budget.consume(1);
  if (
    target === null ||
    !runtime.ownershipConfirmed ||
    !(await lockRuntimeAuthority(tx, runtime.recoveryEpoch)) ||
    target.automationEpoch !== runtime.recoveryEpoch ||
    !target.desiredPresence ||
    !target.monitoring ||
    target.intentionallyRemovedAt !== null
  )
    throw requestedMovieRollbackConflict(
      "The selected movie's current ownership or intent changed",
    );
  const expected = input.expected;
  if (
    expected !== undefined &&
    (media.version !==
      expected.mediaVersion + (input.phase === "rebind" ? 1 : 0) ||
      target.version !== expected.targetVersion ||
      target.generation !== expected.generation ||
      runtime.recoveryEpoch !== expected.recoveryEpoch)
  )
    throw requestedMovieRollbackConflict(
      "The reviewed movie, target or recovery epoch changed",
    );
  const owner = await movieChoiceSubject(tx, {
    actorId: input.actorId,
    subjectUserId: input.actorId,
    purpose: "choose",
    access: input.access,
    mediaSectionId: input.access.movieSectionId,
  });
  budget.consume(owner.mapping === null ? 2 : 3);
  if (owner.actor.role !== "owner" || owner.actor.restricted)
    throw new MediaError(
      "owner_required",
      "A current unrestricted owner must authorize movie rollback",
      403,
    );
  if (owner.freshness === null)
    throw new Error("Movie rollback owner lost its current permission guard");
  const execution = input.invocation.execution;
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: Math.min(execution.expiresAtMs, owner.freshness.expiresAtMs),
    guards: [execution, owner.freshness],
  });
  freshness.assertActive();
  return { media, target, runtime, owner, freshness };
}

/** Exact currently served B and retained A, under the same owner/target/pair locks. */
export async function captureRequestedMovieRollbackContextV1(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    scope: MovieEditionScope;
    sourceAttemptId: string;
    access: MovieChoiceAccess;
    invocation: RequestedMovieRollbackInvocationV1;
  },
) {
  const authority = await captureRequestedMovieRollbackOwnerV1(tx, input);
  const budget = input.invocation.budget;
  const published = await loadMoviePublicationV2(
    tx,
    input.sourceAttemptId,
    budget,
  );
  if (
    published?.outcome?.kind !== "published" ||
    published.attempt.state !== "completed" ||
    identityHash(published.reference.intent.scope) !== identityHash(input.scope)
  )
    throw requestedMovieRollbackConflict(
      "Select the actual completed movie upgrade for this cut",
    );
  const old = published.outcome.entries[0].predecessor;
  const current = published.outcome.entries[0].successor;
  if (old === null || current === null)
    throw requestedMovieRollbackConflict(
      "This publication has no retained predecessor to restore",
    );
  const source = {
    schemaVersion: 4 as const,
    operationId: published.reference.intent.operationId,
    attemptId: input.sourceAttemptId,
    scope: input.scope,
  };
  const serving = await readMoviePlexReceiptV2(tx, source, budget);
  if (serving === null)
    throw requestedMovieRollbackConflict(
      "The selected upgrade has no verified Plex publication",
    );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "LibraryAsset" WHERE id IN (${Prisma.join([old.id, current.id].sort())}) ORDER BY id FOR UPDATE`,
  );
  const predecessor = await snapshotMoviePublicationAssetV2(
    tx,
    input.scope,
    old.id,
    budget,
  );
  const successor = await snapshotMoviePublicationAssetV2(
    tx,
    input.scope,
    current.id,
    budget,
  );
  assertRequestedMovieRollbackPairV1(
    predecessor,
    successor,
    authority.runtime.recoveryEpoch,
  );
  const publication = await findMoviePublicationReferenceV2(
    tx,
    { scope: input.scope, asset: successor },
    budget,
  );
  if (publication === null)
    throw new Error(
      "Currently serving rollback candidate lost its exact physical parent",
    );
  const binding = await readCurrentPlexBinding(
    tx,
    {
      scope: { mediaId: input.scope.mediaId, edition: input.scope.edition },
      assetId: successor.id,
      access: {
        serverMachineId: input.access.serverMachineId,
        sectionId: input.access.movieSectionId,
        sectionType: "movie",
      },
    },
    budget,
  );
  if (binding.status !== "current")
    throw requestedMovieRollbackConflict(
      "Verify the exact current Plex binding before requesting rollback",
    );
  await tx.$queryRaw`SELECT id FROM "UpgradeCleanup" WHERE "assetId"=${predecessor.id} AND "successorAssetId"=${successor.id} FOR UPDATE`;
  const cleanup = await tx.upgradeCleanup.findUnique({
    where: {
      assetId_successorAssetId: {
        assetId: predecessor.id,
        successorAssetId: successor.id,
      },
    },
  });
  budget.consume(cleanup === null ? 0 : 1);
  if (
    cleanup?.state !== "pending" ||
    cleanup.recoveryEpoch !== authority.runtime.recoveryEpoch ||
    cleanup.expiresAt.getTime() <= Date.now()
  )
    throw requestedMovieRollbackConflict(
      "The original rollback window expired or its cleanup already changed",
    );
  authority.freshness.assertActive();
  const context = MovieRollbackContextV1Schema.parse({
    schemaVersion: 1,
    scope: input.scope,
    sourceAttemptId: input.sourceAttemptId,
    expected: {
      mediaVersion: authority.media.version,
      targetVersion: authority.target.version,
      generation: authority.target.generation,
      recoveryEpoch: authority.runtime.recoveryEpoch,
      predecessor: {
        id: predecessor.id,
        version: predecessor.version,
        checksum: predecessor.checksum,
      },
      successor: {
        id: successor.id,
        version: successor.version,
        checksum: successor.checksum,
        publicationHash: identityHash(publication),
      },
      binding: binding.snapshot,
      cleanup: {
        id: cleanup.id,
        version: cleanup.version,
        expiresAt: cleanup.expiresAt.toISOString(),
      },
    },
  });
  return {
    context,
    published,
    serving,
    source,
    authority,
    predecessor,
    successor,
    publication,
    binding,
    cleanup,
  };
}

function assertRequestedMovieRollbackPairV1(
  predecessor: MoviePublicationAssetV2,
  successor: MoviePublicationAssetV2,
  epoch: number,
) {
  if (
    predecessor.state !== "superseded" ||
    predecessor.supersededByAssetId !== successor.id ||
    predecessor.coverage[0].current ||
    successor.state !== "published" ||
    !successor.coverage[0].current ||
    predecessor.ownershipEpoch !== epoch ||
    successor.ownershipEpoch !== epoch
  )
    throw requestedMovieRollbackConflict(
      "The reviewed predecessor and currently serving successor changed",
    );
}
