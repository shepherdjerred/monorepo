import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieRollbackIntentV1 } from "#shared/movie-editions/rollback/physical.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { PlexPointerExpectedSchema } from "#shared/plex-binding/contract.ts";
import { readPlexPointer } from "#infrastructure/plex-binding/records.ts";
import { replacePlexClaims } from "#infrastructure/plex-binding/claims.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { plexCanonicalPathHash } from "#infrastructure/plex-binding/path.ts";
import { FileGuardError } from "#automation/files/types.ts";
import type {
  PlexMovieAssociationV2,
  PlexBindingSnapshot,
} from "#shared/plex-binding/contract.ts";

type Claim = Prisma.PlexClaimGroupGetPayload<{
  include: { members: { include: { item: true } }; parts: true; paths: true };
}>;

function assertRollbackClaimMember(
  claim: Claim,
  input: {
    intent: MovieRollbackIntentV1;
    association: PlexMovieAssociationV2;
    snapshot: PlexBindingSnapshot;
  },
) {
  const { intent, association, snapshot } = input;
  const member = claim.members[0],
    item = member?.item;
  if (
    claim.members.length !== 1 ||
    member?.mediaId !== intent.scope.mediaId ||
    member.edition !== intent.scope.edition ||
    member.evidenceId !== snapshot.evidenceId ||
    member.associationHash !== snapshot.associationHash ||
    item?.evidenceId !== snapshot.evidenceId ||
    item.associationHash !== snapshot.associationHash ||
    item.serverMachineId !== association.access.serverMachineId ||
    item.sectionId !== association.access.sectionId ||
    item.ratingKey !== association.item.ratingKey
  )
    throw new FileGuardError("movie_rollback_claims_changed");
}

function assertRollbackClaimPaths(
  claim: Claim,
  association: PlexMovieAssociationV2,
) {
  const part = association.item.media[0].parts[0],
    group = association.group;
  const server = association.access.serverMachineId;
  if (
    claim.parts.length !== 1 ||
    claim.parts[0]?.partId !== part.id ||
    claim.parts[0].canonicalPath !== part.file ||
    claim.parts[0].serverMachineId !== server ||
    claim.paths.length !== 1 ||
    claim.paths[0]?.canonicalPath !== group.canonicalPath ||
    claim.paths[0].canonicalPathHash !==
      plexCanonicalPathHash(group.canonicalPath) ||
    claim.paths[0].serverMachineId !== server
  )
    throw new FileGuardError("movie_rollback_claims_changed");
}

/** A stale A pointer is historical serving evidence while B is physically
 * current. Retire precisely those pinned claims, never a title-wide group. */
export async function captureMovieRollbackBindingV1(
  tx: Prisma.TransactionClient,
  intent: MovieRollbackIntentV1,
  budget: PublicationAuthorityReadBudget,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"media-plex-binding:" + intent.access.serverMachineId},0))::text`;
  const pointer = await readPlexPointer(tx, intent.pointer.scope, budget);
  if (
    identityHash(pointer.expected) !== identityHash(intent.pointer) ||
    pointer.current?.association.schemaVersion !== 2
  )
    throw new FileGuardError("movie_rollback_pointer_changed");
  const { association, snapshot } = pointer.current;
  const group = association.group;
  const claims = await tx.plexClaimGroup.findMany({
    where: {
      serverMachineId: intent.access.serverMachineId,
      groupHash: identityHash(group),
    },
    include: { members: { include: { item: true } }, parts: true, paths: true },
    take: budget.take,
  });
  budget.consume(
    claims.reduce(
      (count, claim) =>
        count +
        1 +
        claim.members.length +
        claim.members.filter((member) => member.item !== null).length +
        claim.parts.length +
        claim.paths.length,
      0,
    ),
  );
  const claim = claims[0];
  if (
    claim === undefined ||
    claims.length !== 1 ||
    identityHash(claim.group) !== identityHash(group)
  )
    throw new FileGuardError("movie_rollback_claims_changed");
  assertRollbackClaimMember(claim, { intent, association, snapshot });
  assertRollbackClaimPaths(claim, association);
  return { association, group };
}

export async function retireMovieRollbackBindingV1(
  tx: Prisma.TransactionClient,
  input: {
    intent: MovieRollbackIntentV1;
    captured: Awaited<ReturnType<typeof captureMovieRollbackBindingV1>>;
    budget: PublicationAuthorityReadBudget;
    freshness: PlexBindingFreshness;
  },
) {
  const { intent, captured, budget, freshness } = input;
  freshness.assertActive();
  // replacePlexClaims rereads the single captured immutable group.
  budget.consume(1);
  await replacePlexClaims(
    tx,
    {
      serverMachineId: intent.access.serverMachineId,
      oldGroups: [captured.group],
      members: [],
    },
    freshness,
  );
  const cleared =
    await tx.$executeRaw`UPDATE "PlexBindingCurrent" SET "evidenceId"=NULL,"associationHash"=NULL,revision=revision+1,"verifiedStartedAt"=NULL,"verifiedCompletedAt"=NULL
    WHERE "mediaId"=${intent.scope.mediaId} AND edition=${intent.scope.edition} AND revision=${intent.pointer.revision}
      AND "evidenceId"=${intent.pointer.evidence?.id ?? null} AND "associationHash"=${intent.pointer.evidence?.associationHash ?? null}`;
  if (cleared !== 1) throw new FileGuardError("movie_rollback_pointer_changed");
  await tx.plexWatchProjection.deleteMany({
    where: { mediaId: intent.scope.mediaId, edition: intent.scope.edition },
  });
  await tx.watchState.deleteMany({
    where: { mediaId: intent.scope.mediaId, edition: intent.scope.edition },
  });
  freshness.assertActive();
  return PlexPointerExpectedSchema.parse({
    ...intent.pointer,
    revision: intent.pointer.revision + 1,
    evidence: null,
  });
}
