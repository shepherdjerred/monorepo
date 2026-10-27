import type { Prisma } from "#generated/prisma/client.ts";
import {
  PlexAssociationV1Schema,
  type PlexPhysicalGroup,
} from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { parsePlexRecord } from "./records.ts";
import { readPlexPhysicalGroup } from "./read.ts";
import { PlexBindingProtection } from "./errors.ts";
import type { PlexPublicationParent } from "#shared/plex-binding/expected.ts";
import { DefaultAcquisitionIdentitySchema } from "#shared/acquisition/library-management.ts";
import { FilePlanEntrySchema } from "#shared/file-plan.ts";
import { z } from "zod";

type PreviousGroupState = {
  ids: Set<string>;
  oldGroups: Map<string, PlexPhysicalGroup>;
  oldServers: Set<string>;
};

async function readPreviousGroups(
  tx: Prisma.TransactionClient,
  pending: string[],
  state: PreviousGroupState,
) {
  const pointers = await tx.plexBindingCurrent.findMany({
    where: {
      mediaId: { in: pending },
      edition: "default",
      evidenceId: { not: null },
    },
    include: { evidence: true },
  });
  for (const pointer of pointers) {
    if (pointer.evidence === null || pointer.associationHash === null)
      throw new Error("Current Plex evidence disappeared");
    const association = parsePlexRecord(
      PlexAssociationV1Schema,
      pointer.evidence.evidence,
      pointer.associationHash,
    );
    if (pointer.evidence.serverMachineId !== association.access.serverMachineId)
      throw new Error("Plex evidence server projection changed");
    state.oldServers.add(association.access.serverMachineId);
    const previous = state.oldGroups.get(association.group.assetId);
    if (
      previous !== undefined &&
      identityHash(previous) !== identityHash(association.group)
    )
      throw new Error("Current Plex physical group has inconsistent members");
    state.oldGroups.set(association.group.assetId, association.group);
    for (const scope of association.group.coverage)
      state.ids.add(scope.mediaId);
  }
}

async function readCurrentGroups(
  tx: Prisma.TransactionClient,
  pending: string[],
  state: { ids: Set<string>; newGroups: Map<string, PlexPhysicalGroup> },
) {
  const coverage = await tx.assetCoverage.findMany({
    where: { mediaId: { in: pending }, edition: "default", current: true },
    select: { assetId: true },
  });
  for (const assetId of [
    ...new Set(coverage.map((row) => row.assetId)),
  ].sort()) {
    if (state.newGroups.has(assetId)) continue;
    const { asset, group } = await readPlexPhysicalGroup(tx, assetId);
    if (asset.state !== "published")
      throw new PlexBindingProtection("ownership_changed");
    state.newGroups.set(assetId, group);
    for (const scope of group.coverage) state.ids.add(scope.mediaId);
  }
}

/** Full transitive old/new physical coverage, before taking any canonical lock. */
export async function readPlexGroupUnion(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
) {
  const ids = new Set(mediaIds);
  const oldGroups = new Map<string, PlexPhysicalGroup>(),
    newGroups = new Map<string, PlexPhysicalGroup>();
  const oldServers = new Set<string>();
  const visited = new Set<string>();
  for (;;) {
    if (ids.size === 0 || ids.size > 10_000)
      throw new PlexBindingProtection("scope_changed");
    const pending = [...ids].filter((id) => !visited.has(id)).sort();
    if (pending.length === 0) break;
    for (const id of pending) visited.add(id);
    await readPreviousGroups(tx, pending, { ids, oldGroups, oldServers });
    await readCurrentGroups(tx, pending, { ids, newGroups });
    if (oldGroups.size > 100 || newGroups.size > 100)
      throw new PlexBindingProtection("scope_changed");
  }
  const claims = await tx.plexClaimGroupMember.findMany({
    where: { mediaId: { in: [...ids] }, edition: "default" },
    select: { group: { select: { serverMachineId: true } } },
  });
  for (const claim of claims) oldServers.add(claim.group.serverMachineId);
  return {
    mediaIds: [...ids].sort(),
    oldServerMachineIds: [...oldServers].sort(),
    oldGroups: [...oldGroups.values()].sort((a, b) =>
      a.assetId.localeCompare(b.assetId),
    ),
    newGroups: [...newGroups.values()].sort((a, b) =>
      a.assetId.localeCompare(b.assetId),
    ),
  };
}

export async function readPlexIdentityCohort(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
  parents: readonly PlexPublicationParent[],
) {
  const requests = await tx.mediaRequest.findMany({
    where: { mediaId: { in: [...mediaIds] }, active: true, excluded: false },
    select: {
      userId: true,
      movieEditionChoice: { select: { actorId: true, subjectUserId: true } },
    },
  });
  const ids = new Set(
    requests.flatMap((row) => [
      row.userId,
      ...(row.movieEditionChoice === null
        ? []
        : [
            row.movieEditionChoice.actorId,
            row.movieEditionChoice.subjectUserId,
          ]),
    ]),
  );
  const operations = await tx.operation.findMany({
    where: {
      id: {
        in: parents.flatMap((parent) =>
          parent.kind === "existing_asset" ? [] : [parent.operationId],
        ),
      },
    },
    select: { userId: true },
  });
  for (const operation of operations)
    if (operation.userId !== null) ids.add(operation.userId);
  const attempts = await tx.acquisitionAttempt.findMany({
    where: {
      id: {
        in: parents.flatMap((parent) =>
          parent.kind === "acquisition" ? [parent.attemptId] : [],
        ),
      },
    },
    select: { identityEvidence: true },
  });
  for (const attempt of attempts) {
    if (attempt.identityEvidence === null) continue;
    const identity = DefaultAcquisitionIdentitySchema.parse(
      attempt.identityEvidence,
    );
    if (identity.schemaVersion === 1) {
      ids.add(identity.sponsorAuthority.actorId);
      ids.add(identity.sponsorAuthority.userId);
    } else ids.add(identity.management.actorId);
  }
  return [...ids].sort();
}

type PublicationAssetInput = {
  groups: readonly PlexPhysicalGroup[];
  oldGroups: readonly PlexPhysicalGroup[];
  mediaIds: readonly string[];
  parents: readonly PlexPublicationParent[];
};

function addAttemptAssetLocks(
  attempt: { id: string; filePlan: unknown },
  input: PublicationAssetInput,
  ids: Set<string>,
) {
  for (const entry of z
    .array(FilePlanEntrySchema)
    .min(1)
    .max(100)
    .parse(attempt.filePlan)) {
    const rollback = input.parents.some(
      (parent) => parent.kind === "rollback" && parent.attemptId === attempt.id,
    );
    if (
      rollback &&
      !input.groups.some((group) => group.assetId === entry.previousAssetId)
    )
      continue;
    if (entry.mediaIds.some((id) => !input.mediaIds.includes(id)))
      throw new PlexBindingProtection("scope_changed");
    ids.add(entry.assetId);
    if (entry.previousAssetId !== null) ids.add(entry.previousAssetId);
  }
}

/** Publication timestamps also touch exact retained predecessors, even before the first binding. */
export async function readPlexPublicationAssetLocks(
  tx: Prisma.TransactionClient,
  input: PublicationAssetInput,
) {
  const ids = new Set(
    [...input.groups, ...input.oldGroups].map((group) => group.assetId),
  );
  const attempts = await tx.acquisitionAttempt.findMany({
    where: {
      id: {
        in: input.parents.flatMap((parent) =>
          parent.kind === "acquisition" || parent.kind === "rollback"
            ? [parent.attemptId]
            : [],
        ),
      },
    },
    select: { id: true, filePlan: true },
  });
  for (const attempt of attempts) addAttemptAssetLocks(attempt, input, ids);
  // Compensation has its own exact retained/successor closure and never writes ordinary publication timestamps.
  if (input.parents.some((parent) => parent.kind === "compensation"))
    return [...ids].sort();
  const retained = await tx.libraryAsset.findMany({
    where: {
      supersededByAssetId: { in: input.groups.map((group) => group.assetId) },
      edition: "default",
      owned: true,
      state: "superseded",
    },
    select: { id: true, coverage: { select: { mediaId: true } } },
    take: 201,
  });
  if (retained.length > 200) throw new PlexBindingProtection("scope_changed");
  for (const asset of retained) {
    if (
      asset.coverage.length === 0 ||
      asset.coverage.some((row) => !input.mediaIds.includes(row.mediaId))
    )
      throw new PlexBindingProtection("scope_changed");
    ids.add(asset.id);
  }
  return [...ids].sort();
}
