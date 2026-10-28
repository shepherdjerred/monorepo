import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  MovieQuarantinePlexReceiptV2Schema,
  type MovieQuarantinePlexReceiptV2,
} from "#shared/movie-editions/quarantine-v2.ts";
import type {
  PlexBindingFreshness,
  PlexAssociation,
} from "#shared/plex-binding/contract.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  parsePlexRecord,
  readPlexPointer,
} from "#infrastructure/plex-binding/records.ts";
import { readPlexPhysicalGroup } from "#infrastructure/plex-binding/read.ts";
import { replacePlexClaims } from "#infrastructure/plex-binding/claims.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { plexCanonicalPathHash } from "#infrastructure/plex-binding/path.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";

/** The caller still owns the same final canonical/asset/server locks as the physical commit. */
export async function retireMovieQuarantineBinding(
  tx: Prisma.TransactionClient,
  input: {
    receipt: MovieQuarantinePlexReceiptV2;
    budget: PublicationAuthorityReadBudget;
  },
  freshness: PlexBindingFreshness,
) {
  freshness.assertActive();
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.receipt.operationId },
  });
  input.budget.consume(1);
  const raw = z
    .object({ movieQuarantinePlexReceiptV2: z.json() })
    .parse(operation.result).movieQuarantinePlexReceiptV2;
  const receipt = parsePlexRecord(
    MovieQuarantinePlexReceiptV2Schema,
    raw,
    identityHash(input.receipt),
  );
  const pointer = await readPlexPointer(
    tx,
    { mediaId: receipt.scope.mediaId, edition: receipt.scope.edition },
    input.budget,
  );
  const group = receipt.groups[0];
  const binding = receipt.bindings[0];
  if (
    pointer.current?.association.schemaVersion !== 2 ||
    identityHash(pointer.current.snapshot) !== identityHash(binding) ||
    identityHash(pointer.current.association.group) !== identityHash(group)
  )
    throw new PlexBindingProtection("binding_changed");
  const { asset, group: current } = await readPlexPhysicalGroup(
    tx,
    group.assetId,
  );
  input.budget.consume(1 + asset.coverage.length);
  if (
    asset.state !== "quarantined" ||
    identityHash(current) !==
      identityHash({ ...group, assetVersion: group.assetVersion + 1 })
  )
    throw new PlexBindingProtection("ownership_changed");
  const association = pointer.current.association;
  const serverMachineId = association.access.serverMachineId;
  const claims = await tx.plexClaimGroup.findMany({
    where: { serverMachineId, groupHash: identityHash(group) },
    include: { members: { include: { item: true } }, parts: true, paths: true },
    take: 2,
  });
  input.budget.consume(
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
  assertMovieQuarantineClaims(claims, receipt, association);
  freshness.assertActive();
  await bindPlexTransactionDeadline(tx, freshness);
  // replacePlexClaims rereads this one known group; charge the same caller allowance again.
  input.budget.consume(1);
  await replacePlexClaims(
    tx,
    { serverMachineId, oldGroups: [group], members: [] },
    freshness,
  );
  const cleared =
    await tx.$executeRaw`UPDATE "PlexBindingCurrent" SET "evidenceId"=NULL,"associationHash"=NULL,
    revision=revision+1,"verifiedStartedAt"=NULL,"verifiedCompletedAt"=NULL
    WHERE "mediaId"=${receipt.scope.mediaId} AND edition=${receipt.scope.edition}
      AND "evidenceId"=${binding.evidenceId} AND "associationHash"=${binding.associationHash} AND revision=${binding.revision}`;
  if (cleared !== 1) throw new PlexBindingProtection("binding_changed");
  await tx.plexWatchProjection.deleteMany({
    where: { mediaId: receipt.scope.mediaId, edition: receipt.scope.edition },
  });
  await tx.watchState.deleteMany({
    where: { mediaId: receipt.scope.mediaId, edition: receipt.scope.edition },
  });
  freshness.assertActive();
}

type Claim = Prisma.PlexClaimGroupGetPayload<{
  include: { members: { include: { item: true } }; parts: true; paths: true };
}>;

function assertMovieQuarantineClaims(
  claims: Claim[],
  receipt: MovieQuarantinePlexReceiptV2,
  association: PlexAssociation,
) {
  const claim = claims[0];
  const member = claim?.members[0];
  const item = member?.item;
  const binding = receipt.bindings[0];
  if (
    claim === undefined ||
    claims.length !== 1 ||
    identityHash(claim.group) !== identityHash(receipt.groups[0]) ||
    claim.members.length !== 1 ||
    member?.mediaId !== receipt.scope.mediaId ||
    member.edition !== receipt.scope.edition ||
    member.evidenceId !== binding.evidenceId ||
    member.associationHash !== binding.associationHash ||
    item?.serverMachineId !== association.access.serverMachineId ||
    item.sectionId !== association.access.sectionId ||
    item.ratingKey !== association.item.ratingKey ||
    item.evidenceId !== binding.evidenceId ||
    item.associationHash !== binding.associationHash
  )
    throw new PlexBindingProtection("binding_changed");
  assertMovieQuarantinePaths(claim, association);
}

function assertMovieQuarantinePaths(
  claim: Claim,
  association: PlexAssociation,
) {
  const server = association.access.serverMachineId;
  const part = association.item.media[0].parts[0];
  const group = association.group;
  if (
    claim.parts.length !== 1 ||
    claim.parts[0]?.serverMachineId !== server ||
    claim.parts[0].partId !== part.id ||
    claim.parts[0].canonicalPath !== part.file ||
    claim.paths.length !== 1 ||
    claim.paths[0]?.serverMachineId !== server ||
    claim.paths[0].canonicalPath !== group.canonicalPath ||
    claim.paths[0].canonicalPathHash !==
      plexCanonicalPathHash(group.canonicalPath)
  )
    throw new PlexBindingProtection("binding_changed");
}
