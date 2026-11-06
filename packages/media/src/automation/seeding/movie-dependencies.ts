import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { MoviePublicationOutcomeV2Schema } from "#shared/movie-editions/publication-v2.ts";
import type { MovieSourceCohort as Cohort } from "./movie-types.ts";
import path from "node:path";
import { movieCaptionUsesPublishedLibrary } from "./movie-library-work.ts";
import {
  movieRolledBackSourceCompletionsV1,
  movieRetainedRollbackAssetV1,
  movieCaptionUsesRetainedRollbackV1,
  movieRollbackUsesCompletedLibraryV1,
} from "./movie-rollback.ts";

function sourceOverlaps(physical: string, isolated: string) {
  const resolved = path.resolve(physical);
  return (
    resolved === isolated ||
    resolved.startsWith(`${isolated}/`) ||
    isolated.startsWith(`${resolved}/`)
  );
}

export async function movieSourcePublicationDependencies(
  tx: Prisma.TransactionClient,
  torrent: Cohort,
  input: { scope: MovieEditionScope; isolated: string },
  budget: PublicationAuthorityReadBudget,
) {
  const { scope } = input;
  const transitions = await tx.mediaPublicationTransition.findMany({
    where: { attemptId: { in: torrent.attempts.map((a) => a.id) } },
    take: budget.take,
  });
  budget.consume(transitions.length);
  const fences = await tx.nativePublicationCompensationContinuation.findMany({
    where: {
      OR: [
        { transitionId: { in: transitions.map((t) => t.id) } },
        { mediaIds: { has: scope.mediaId } },
        { assetIds: { hasSome: torrent.assets.map((a) => a.id) } },
      ],
    },
    take: budget.take,
  });
  budget.consume(fences.length);
  let dependenciesRemaining = fences.some(
    (f) =>
      f.fenceRelease === null ||
      !["compensated", "published", "completed"].includes(f.state),
  );
  const pending = await tx.operation.findMany({
    where: {
      status: { in: ["queued", "running"] },
      NOT: { kind: "maintain_torrent" },
      OR: [
        { targetId: { in: torrent.assets.map((a) => a.id) } },
        {
          targetId: scope.mediaId,
          kind: {
            notIn: ["reconcile_movie_edition_v4", "acquire_movie_edition_v4"],
          },
          payload: { path: ["scope", "edition"], equals: scope.edition },
        },
      ],
    },
    take: budget.take,
  });
  budget.consume(pending.length);
  const replacements = await tx.subtitleReplacement.findMany({
    where: {
      assetId: { in: torrent.assets.map((a) => a.id) },
      reservationActive: true,
    },
    take: budget.take,
  });
  budget.consume(replacements.length);
  const rollbacks = await movieRolledBackSourceCompletionsV1(
    tx,
    torrent,
    scope,
    budget,
  );
  // Upgrade cleanup's validated plan contains rollback/quarantine paths under
  // library control, never downloads. The actual source assets are proven below.
  if (
    pending.some(
      (operation) =>
        !movieCaptionUsesPublishedLibrary(operation, torrent, scope) &&
        !movieRollbackUsesCompletedLibraryV1(operation, scope, rollbacks) &&
        !movieCaptionUsesRetainedRollbackV1(
          operation,
          torrent,
          scope,
          rollbacks,
        ),
    ) ||
    replacements.length > 0
  )
    dependenciesRemaining = true;
  const outcomes = transitions.map((t) => ({
    transition: t,
    parsed:
      t.outcome === null
        ? null
        : MoviePublicationOutcomeV2Schema.parse(t.outcome),
  }));
  if (
    outcomes.some(
      ({ transition, parsed }) =>
        parsed !== null &&
        (identityHash(parsed) !== transition.outcomeHash ||
          parsed.transitionId !== transition.id ||
          parsed.intentHash !== transition.intentHash ||
          parsed.filePlanHash !== transition.filePlanHash ||
          parsed.birthEpoch !== torrent.ownershipEpoch ||
          identityHash(parsed.scope) !== identityHash(scope)),
    )
  )
    return null;
  for (const member of torrent.attempts) {
    if (
      !["cancelled", "completed"].includes(member.state) &&
      !rollbacks.has(member.id)
    )
      dependenciesRemaining = true;
    if (member.filePlan === null) {
      if (member.state === "completed") dependenciesRemaining = true;
      continue;
    }
    const outcome = outcomes.find((o) => o.transition.attemptId === member.id);
    const parsed = outcome?.parsed;
    if (parsed === undefined || parsed === null) dependenciesRemaining = true;
  }
  const assets = knownSourceAssets(torrent, input, outcomes, rollbacks);
  return assets === null ? null : dependenciesRemaining || assets;
}

function knownSourceAssets(
  torrent: Cohort,
  input: { scope: MovieEditionScope; isolated: string },
  outcomes: {
    parsed: ReturnType<typeof MoviePublicationOutcomeV2Schema.parse> | null;
  }[],
  rollbacks: Awaited<ReturnType<typeof movieRolledBackSourceCompletionsV1>>,
) {
  const { scope, isolated } = input;
  let dependenciesRemaining = false;
  for (const asset of torrent.assets) {
    if (
      !asset.owned ||
      asset.ownershipEpoch !== torrent.ownershipEpoch ||
      asset.editionRootId !== scope.mediaId ||
      asset.edition !== scope.edition ||
      asset.coverage.length !== 1 ||
      asset.coverage[0]?.mediaId !== scope.mediaId ||
      asset.coverage[0].edition !== scope.edition
    )
      return null;
    if (
      !["published", "superseded", "quarantined", "purged"].includes(
        asset.state,
      ) &&
      !movieRetainedRollbackAssetV1(asset, rollbacks)
    )
      dependenciesRemaining = true;
    const parents = outcomes.flatMap(
      ({ parsed }) =>
        parsed?.entries.flatMap((e) => [e.predecessor, e.successor]) ?? [],
    );
    if (
      !parents.some(
        (p) =>
          p?.id === asset.id &&
          p.checksum === asset.checksum &&
          p.sizeBytes === asset.sizeBytes.toString(),
      )
    )
      return null;
    if (sourceOverlaps(asset.path, isolated)) return null;
  }
  return dependenciesRemaining;
}
