import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type {
  PlexAssociation,
  PlexBindingFreshness,
  PlexPhysicalGroup,
} from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { plexCanonicalPathHash } from "./path.ts";
import { PlexBindingProtection } from "./errors.ts";

type Member = {
  association: PlexAssociation;
  evidenceId: string;
  associationHash: string;
};

/** Caller owns the full old/new canonical union and its single configured-server mutex. */
export async function replacePlexClaims(
  tx: Prisma.TransactionClient,
  input: {
    serverMachineId: string;
    oldGroups: readonly PlexPhysicalGroup[];
    members: readonly Member[];
  },
  freshness: PlexBindingFreshness,
): Promise<void> {
  const oldHashes = input.oldGroups.map((group) => identityHash(group));
  const old = await tx.plexClaimGroup.findMany({
    where: {
      serverMachineId: input.serverMachineId,
      groupHash: { in: oldHashes },
    },
  });
  freshness.assertActive();
  const oldIds = old.map((row) => row.id);
  const groups = new Map<
    string,
    { id: string; group: PlexPhysicalGroup; hash: string }
  >();
  for (const member of input.members) {
    if (member.association.access.serverMachineId !== input.serverMachineId)
      throw new PlexBindingProtection("wrong_server");
    const hash = identityHash(member.association.group);
    if (!groups.has(hash))
      groups.set(hash, {
        id: crypto.randomUUID(),
        group: member.association.group,
        hash,
      });
  }
  const items = input.members.map((member) => {
    const { association } = member;
    const group = groups.get(identityHash(association.group));
    if (group === undefined)
      throw new Error("Plex claim member omitted its group");
    return {
      serverMachineId: input.serverMachineId,
      sectionId: association.access.sectionId,
      ratingKey: association.item.ratingKey,
      groupId: group.id,
      mediaId: association.scope.mediaId,
      edition: association.scope.edition,
      evidenceId: member.evidenceId,
      associationHash: member.associationHash,
    };
  });
  const parts = new Map<
    string,
    {
      serverMachineId: string;
      partId: string;
      groupId: string;
      canonicalPath: string;
    }
  >();
  for (const member of input.members) {
    const part = member.association.item.media[0].parts[0];
    const group = groups.get(identityHash(member.association.group));
    if (group === undefined) throw new Error("Plex Part omitted its group");
    const prior = parts.get(part.id);
    if (
      prior !== undefined &&
      (prior.groupId !== group.id || prior.canonicalPath !== part.file)
    )
      throw new PlexBindingProtection("ambiguous_item");
    parts.set(part.id, {
      serverMachineId: input.serverMachineId,
      partId: part.id,
      groupId: group.id,
      canonicalPath: part.file,
    });
  }
  const paths = [...groups.values()].map((row) => ({
    serverMachineId: input.serverMachineId,
    groupId: row.id,
    canonicalPath: row.group.canonicalPath,
    canonicalPathHash: plexCanonicalPathHash(row.group.canonicalPath),
  }));
  if (
    new Set(items.map((row) => `${row.sectionId}/${row.ratingKey}`)).size !==
      items.length ||
    new Set(paths.map((row) => row.canonicalPathHash)).size !== paths.length
  )
    throw new PlexBindingProtection("ambiguous_item");
  // Conflict inspection never acquires a foreign canonical root or attempts adoption.
  const conflicts = await Promise.all([
    tx.plexItemClaim.count({
      where: {
        serverMachineId: input.serverMachineId,
        groupId: { notIn: oldIds },
        OR: items.map((row) => ({
          sectionId: row.sectionId,
          ratingKey: row.ratingKey,
        })),
      },
    }),
    tx.plexPartClaim.count({
      where: {
        serverMachineId: input.serverMachineId,
        groupId: { notIn: oldIds },
        partId: { in: [...parts.keys()] },
      },
    }),
    tx.plexPathClaim.count({
      where: {
        serverMachineId: input.serverMachineId,
        groupId: { notIn: oldIds },
        canonicalPathHash: { in: paths.map((row) => row.canonicalPathHash) },
      },
    }),
  ]);
  freshness.assertActive();
  if (conflicts.some((count) => count > 0))
    throw new PlexBindingProtection("ambiguous_item");
  await removePlexClaimGroups(tx, oldIds, freshness);
  if (groups.size === 0) return;
  await tx.plexClaimGroup.createMany({
    data: [...groups.values()].map((row) => ({
      id: row.id,
      serverMachineId: input.serverMachineId,
      groupHash: row.hash,
      group: z.record(z.string(), z.json()).parse(row.group),
    })),
  });
  freshness.assertActive();
  await tx.plexClaimGroupMember.createMany({
    data: items.map(
      ({
        serverMachineId: _server,
        sectionId: _section,
        ratingKey: _rating,
        ...row
      }) => row,
    ),
  });
  freshness.assertActive();
  await tx.plexItemClaim.createMany({ data: items });
  freshness.assertActive();
  await tx.plexPartClaim.createMany({ data: [...parts.values()] });
  freshness.assertActive();
  await tx.plexPathClaim.createMany({ data: paths });
  freshness.assertActive();
}

async function removePlexClaimGroups(
  tx: Prisma.TransactionClient,
  groupIds: string[],
  freshness: PlexBindingFreshness,
) {
  if (groupIds.length === 0) return;
  await tx.plexItemClaim.deleteMany({ where: { groupId: { in: groupIds } } });
  freshness.assertActive();
  await tx.plexPartClaim.deleteMany({ where: { groupId: { in: groupIds } } });
  freshness.assertActive();
  await tx.plexPathClaim.deleteMany({ where: { groupId: { in: groupIds } } });
  freshness.assertActive();
  await tx.plexClaimGroupMember.deleteMany({
    where: { groupId: { in: groupIds } },
  });
  freshness.assertActive();
  await tx.plexClaimGroup.deleteMany({ where: { id: { in: groupIds } } });
  freshness.assertActive();
}
