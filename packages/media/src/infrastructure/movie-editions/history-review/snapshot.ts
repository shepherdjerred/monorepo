import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import {
  MovieHistoryScopeV3Schema,
  MovieHistoryRequestV3Schema,
  MovieHistoryChoiceV3Schema,
  MovieHistoryKeepV3Schema,
  type MovieHistoryScopeV3,
} from "#shared/movie-editions/history-review-v3.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { movieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import {
  movieDefinitionRef,
  matchesMovieDefinition,
} from "#infrastructure/movie-editions/definition.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { findMoviePublicationReferenceV2 } from "#infrastructure/movie-editions/publication/store.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { recoveryHouseholdPairs } from "#infrastructure/recovery/household.ts";
import { requiredClaimAcknowledgements } from "#infrastructure/recovery/legacy-claims/accounting.ts";
import { buildMovieRecoveryClaimsV3 } from "#infrastructure/recovery/legacy-claims/movie/projection.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { movieHistoryAdoptionSourceV3 } from "./source.ts";
import { movieHistoryConflict } from "./locks.ts";

const hash = (value: unknown) => identityHash(nativeJson(value));

/** Caller owns the exact canonical/household/knowledge/physical locks and original provenance allowance. */
export async function snapshotMovieHistoryV3(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; access: MovieChoiceAccess },
  budget: PublicationAuthorityReadBudget,
) {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const { scope, access } = input;
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: scope.mediaId },
  });
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
  });
  const hold = await tx.recoveryHold.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
  });
  if (
    media.kind !== "movie" ||
    media.id !== scope.rootMediaId ||
    target.editionRootId !== scope.rootMediaId ||
    hold.releasedAt !== null
  )
    throw movieHistoryConflict(
      "Select the actual unreleased history hold for this one movie cut",
    );
  const definition = movieDefinitionRef(scope.mediaId, scope.edition);
  const stored = await tx.mediaEditionDefinition.findUniqueOrThrow({
    where: {
      rootMediaId_key: { rootMediaId: scope.rootMediaId, key: scope.edition },
    },
  });
  if (!matchesMovieDefinition(stored, definition.definition))
    throw movieHistoryConflict(
      "Current movie definition differs from the registered cut",
    );
  const current = await movieHistoryPhysical(tx, input, budget);
  const original = await movieHistoryAdoptionSourceV3(
    tx,
    { scope, epoch: runtime.recoveryEpoch },
    budget,
  );
  const claims = await buildMovieRecoveryClaimsV3(
    tx,
    { scope, epoch: runtime.recoveryEpoch, report: original.report },
    budget,
  );
  const requests = await movieHistoryRequests(tx, scope);
  const choices = await movieHistoryChoices(tx, requests, budget);
  const keeps = await tx.retentionHold.findMany({
    where: { mediaId: scope.mediaId, edition: scope.edition },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (keeps.length > 100)
    throw movieHistoryConflict(
      "Selected movie Keep inventory exceeds its native bound",
    );
  const users = await tx.mediaUser.findMany({
    include: { plexIdentity: true },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (users.length > 100)
    throw movieHistoryConflict("Household exceeds its native review bound");
  const household = recoveryHouseholdPairs({
    users,
    scope: {
      media: [
        {
          id: media.id,
          title: media.title,
          kind: "movie",
          sectionId: access.movieSectionId,
          version: media.version,
          generation: target.generation,
          automationEpoch: target.automationEpoch,
        },
      ],
      requests: z.array(z.json()).parse(nativeJson(requests)),
      personalHolds: z.array(z.json()).parse(nativeJson(keeps)),
    },
    machineId: access.serverMachineId,
    ancestorsByMedia: { [media.id]: [] },
    relevantClaims: claims.relevantClaims,
  });
  const roster = household.roster.map((user) => ({
    ...user,
    claimAcknowledgements: requiredClaimAcknowledgements(
      claims.claims,
      user.id,
    ),
  }));
  const active = roster.filter((user) => user.applicableMediaIds.length > 0);
  const blockers = [...claims.blockers, ...household.blockers];
  if (
    runtime.mode !== "active" ||
    !runtime.ownershipConfirmed ||
    target.automationEpoch !== runtime.recoveryEpoch ||
    hold.recoveryEpoch !== runtime.recoveryEpoch
  )
    blockers.push("movie_history_runtime_changed");
  if (
    await tx.acquisitionReservation.count({
      where: { mediaId: scope.mediaId, edition: scope.edition },
    })
  )
    blockers.push("movie_history_acquisition_unsettled");
  if (
    await tx.subtitleReplacement.count({
      where: { assetId: current.asset.id, reservationActive: true },
    })
  )
    blockers.push("subtitle_replacement_unsettled");
  const profile =
    target.profileId === null
      ? null
      : await tx.qualityProfile.findUniqueOrThrow({
          where: { id: target.profileId },
        });
  const captured = MovieHistoryScopeV3Schema.parse(
    nativeJson({
      schemaVersion: 3,
      scope,
      definition: {
        definitionVersion: definition.definitionVersion,
        definitionDigest: definition.definitionDigest,
      },
      registryVersion: 1,
      recoveryEpoch: runtime.recoveryEpoch,
      runtimeVersion: runtime.version,
      media: {
        id: media.id,
        kind: media.kind,
        title: media.title,
        version: media.version,
      },
      target: {
        mediaId: target.mediaId,
        edition: target.edition,
        editionRootId: target.editionRootId,
        version: target.version,
        generation: target.generation,
        automationEpoch: target.automationEpoch,
        profileId: target.profileId,
        desiredPresence: target.desiredPresence,
        monitoring: target.monitoring,
        libraryMonitoring: target.libraryMonitoring,
        availability: target.availability,
        intentionallyRemovedAt: target.intentionallyRemovedAt,
      },
      profile:
        profile === null
          ? null
          : {
              id: profile.id,
              version: profile.version,
              rulesHash: hash(profile.rules),
            },
      hold: {
        mediaId: hold.mediaId,
        edition: hold.edition,
        version: hold.version,
        recoveryEpoch: hold.recoveryEpoch,
        reason: hold.reason,
        createdAt: hold.createdAt,
      },
      access,
      adoption: original.adoption,
      publication: current.publication,
      asset: current.asset,
      binding: current.binding,
      requests,
      choices,
      personalHolds: MovieHistoryKeepV3Schema.array().parse(nativeJson(keeps)),
      users: active,
      householdRoster: roster,
      excludedPairs: household.excluded,
      legacyClaims: claims.claims,
      blockers: [...new Set(blockers)].sort(),
    }),
  );
  const guards = active.flatMap((subject) => {
    const mapping = users.find((user) => user.id === subject.id)?.plexIdentity;
    const verified = mapping?.verifiedAt;
    return verified == null ||
      verified.getTime() > Date.now() ||
      verified.getTime() < Date.now() - 300_000
      ? []
      : [movieChoiceFreshness(verified, observed)];
  });
  const freshness = {
    expiresAtMs: Math.min(
      ...guards.map((guard) => guard.expiresAtMs),
      observed.wall + 300_000,
    ),
    assertActive: () => {
      for (const guard of guards) guard.assertActive();
    },
  };
  freshness.assertActive();
  return {
    scope: captured,
    freshness,
    sql: {
      ...claims.sql,
      publicationParents: movieHistoryPublicationSqlRows(
        current.publication,
        original.libraryParentSqlRows,
      ),
    },
  };
}

function movieHistoryPublicationSqlRows(
  parent: MovieHistoryScopeV3["publication"],
  libraryRows: number,
) {
  switch (parent.kind) {
    case "movie_library_adoption_v2":
      return libraryRows;
    case "movie_publication_transition_v2":
    case "movie_restore_publication_v1":
    case "movie_rollback_publication_v1":
      return 1;
    default: {
      const unreachable: never = parent;
      throw new Error(
        `Unknown movie history publication parent: ${String(unreachable)}`,
      );
    }
  }
}

async function movieHistoryRequests(
  tx: Prisma.TransactionClient,
  scope: MovieEditionScope,
) {
  const rows = await tx.mediaRequest.findMany({
    where: { mediaId: scope.mediaId, edition: scope.edition },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (rows.length > 100)
    throw movieHistoryConflict(
      "Selected movie request inventory exceeds its native review bound",
    );
  return rows.map((row) =>
    MovieHistoryRequestV3Schema.parse(
      nativeJson({
        id: row.id,
        userId: row.userId,
        mediaId: row.mediaId,
        edition: row.edition,
        version: row.version,
        active: row.active,
        excluded: row.excluded,
        direct: row.direct,
        movieEditionChoiceId: row.movieEditionChoiceId,
        movieEditionChoiceRevision: row.movieEditionChoiceRevision,
        subtitleLanguages: row.subtitleLanguages,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
    ),
  );
}

async function movieHistoryChoices(
  tx: Prisma.TransactionClient,
  requests: Awaited<ReturnType<typeof movieHistoryRequests>>,
  budget: PublicationAuthorityReadBudget,
) {
  const ids = requests.flatMap((request) =>
    request.movieEditionChoiceId === null ? [] : [request.movieEditionChoiceId],
  );
  const rows = await tx.movieEditionChoice.findMany({
    where: { id: { in: ids } },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(rows.length);
  if (rows.length !== ids.length)
    throw new Error(
      "Movie household current choice pointer lost its immutable parent",
    );
  return MovieHistoryChoiceV3Schema.array().parse(nativeJson(rows));
}

async function movieHistoryPhysical(
  tx: Prisma.TransactionClient,
  input: { scope: MovieEditionScope; access: MovieChoiceAccess },
  budget: PublicationAuthorityReadBudget,
) {
  const rows = await tx.assetCoverage.findMany({
    where: {
      mediaId: input.scope.mediaId,
      edition: input.scope.edition,
      current: true,
    },
    orderBy: { assetId: "asc" },
    take: 2,
  });
  const selected = rows[0];
  if (selected === undefined || rows.length !== 1)
    throw movieHistoryConflict(
      "Household review needs this cut's one actual current physical video",
    );
  const asset = await snapshotMoviePublicationAssetV2(
    tx,
    input.scope,
    selected.assetId,
    budget,
  );
  const publication = await findMoviePublicationReferenceV2(
    tx,
    { scope: input.scope, asset },
    budget,
  );
  if (publication === null)
    throw new Error(
      "Movie household current video has no actual immutable physical parent",
    );
  const binding = await readCurrentPlexBinding(
    tx,
    {
      scope: { mediaId: input.scope.mediaId, edition: input.scope.edition },
      assetId: asset.id,
      access: {
        serverMachineId: input.access.serverMachineId,
        sectionId: input.access.movieSectionId,
        sectionType: "movie",
      },
    },
    budget,
  );
  if (binding.status !== "current")
    throw movieHistoryConflict(
      "Verify the actual current Plex binding before reviewing household history",
    );
  return { asset, publication, binding: binding.snapshot };
}
