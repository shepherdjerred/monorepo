import { expect } from "vitest";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  MOVIE_EDITION_REGISTRY,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import {
  PlexAssociationV1Schema,
  type PlexAssociationV1,
} from "#shared/plex-binding/contract.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import { plexCanonicalPathHash } from "#infrastructure/plex-binding/path.ts";

type Tx = Prisma.TransactionClient;
export type Group = {
  id: string;
  associations: { id: string; hash: string; value: PlexAssociationV1 }[];
};
let catalogSequence = 100_000;

export function freshness(milliseconds = 30_000) {
  const wall = Date.now();
  return plexBindingFreshness({
    observed: { wall, monotonic: performance.now() },
    expiresAtMs: wall + milliseconds,
    guards: [],
  });
}

export function first(group: Group) {
  const row = group.associations[0];
  if (row === undefined) throw new Error("Empty schema fixture group");
  return row;
}

/** Direct relational backstop fixture, not a publication or authority producer. */
export async function graph(
  db: Database,
  options: { leaves?: number; groups?: number; edition?: MovieEditionKey } = {},
) {
  const edition = options.edition ?? "default";
  const movie = edition !== "default";
  const leaves = options.leaves ?? 2;
  const count = options.groups ?? 1;
  if (movie && (leaves !== 1 || count !== 1))
    throw new Error("Named fixture must be one movie");
  const rootId = crypto.randomUUID(),
    seasonId = crypto.randomUUID();
  const server = crypto.randomUUID();
  catalogSequence += 1;
  const rootCatalogId = catalogSequence;
  await db.mediaItem.create({
    data: {
      id: rootId,
      kind: movie ? "movie" : "series",
      title: "Plex schema fixture",
      catalogState: "ready",
      tmdbId: rootCatalogId,
      externalIds: { tmdb: rootCatalogId },
    },
  });
  if (!movie)
    await db.mediaItem.create({
      data: {
        id: seasonId,
        kind: "season",
        title: "Season 1",
        parentId: rootId,
        seasonNumber: 1,
      },
    });
  const mediaIds = movie
    ? [rootId]
    : Array.from({ length: leaves * count }, () => crypto.randomUUID());
  if (!movie)
    await db.mediaItem.createMany({
      data: mediaIds.map((id, index) => ({
        id,
        kind: "episode" as const,
        title: `Episode ${String(index + 1)}`,
        parentId: seasonId,
        catalogState: "ready",
        seasonNumber: 1,
        episodeNumber: index + 1,
      })),
    });
  const registered = MOVIE_EDITION_REGISTRY[edition];
  const definition = {
    rootMediaId: rootId,
    key: edition,
    definitionVersion: 0,
    policy: registered.policy,
    pathLabel: registered.pathLabel,
    plexLabel: registered.plexLabel,
  };
  await db.mediaEditionDefinition.create({
    data: { ...definition, displayLabel: registered.displayLabel },
  });
  await db.mediaIntent.createMany({
    data: mediaIds.map((mediaId) => ({
      mediaId,
      edition,
      editionRootId: rootId,
      automationEpoch: 0,
    })),
  });
  // Opaque SQL-fixture identity digests; this suite does not assert canonical-loader authority.
  const canonicalIdentityHash = identityHash({ rootId, tmdbId: rootCatalogId });
  const numberingHash = identityHash(
    mediaIds.map((mediaId, index) => ({
      mediaId,
      seasonNumber: 1,
      episodeNumber: index + 1,
    })),
  );
  const groups: Group[] = Array.from({ length: count }, (_, index) => {
    const assetId = crypto.randomUUID();
    const canonicalPath = `/data/${movie ? "movies" : "tv"}/${rootId}/${assetId}.mkv`;
    const coverage = mediaIds
      .slice(index * leaves, (index + 1) * leaves)
      .sort()
      .map((mediaId) => ({ mediaId, edition }));
    const physical = {
      assetId,
      assetVersion: 0,
      checksum: identityHash(assetId),
      sizeBytes: "9007199254740993",
      canonicalPath,
      ownershipEpoch: 0,
      canonicalRootId: rootId,
      edition,
      coverage,
      coverageHash: identityHash(coverage),
    };
    return {
      id: crypto.randomUUID(),
      associations: coverage.map((scope, member) => {
        const episodeNumber = mediaIds.indexOf(scope.mediaId) + 1;
        const ratingKey = String(index * leaves + member + 1000);
        const value = PlexAssociationV1Schema.parse({
          schemaVersion: 1,
          kind: movie ? "movie" : "episode",
          scope,
          editionRootId: rootId,
          definition: {
            rootMediaId: rootId,
            key: edition,
            definitionVersion: 0,
            definitionHash: identityHash(definition),
          },
          canonicalIdentityHash,
          numberingHash,
          group: physical,
          access: {
            serverMachineId: server,
            sectionId: "1",
            sectionType: movie ? "movie" : "show",
          },
          item: {
            ratingKey,
            type: movie ? "movie" : "episode",
            guids: [`tmdb://${String(movie ? rootCatalogId : episodeNumber)}`],
            media: [
              { parts: [{ id: String(index + 1), file: canonicalPath }] },
            ],
          },
          ...(movie
            ? {}
            : {
                hierarchy: {
                  episode: {
                    ratingKey,
                    parentRatingKey: "2",
                    grandparentRatingKey: "1",
                    index: episodeNumber,
                    parentIndex: 1,
                  },
                  season: {
                    ratingKey: "2",
                    type: "season",
                    index: 1,
                    parentRatingKey: "1",
                  },
                  show: {
                    ratingKey: "1",
                    type: "show",
                    guids: [`tmdb://${String(rootCatalogId)}`],
                  },
                },
              }),
        });
        return { id: crypto.randomUUID(), hash: identityHash(value), value };
      }),
    };
  });
  await db.libraryAsset.createMany({
    data: groups.map((group) => {
      const value = first(group).value.group;
      return {
        id: value.assetId,
        edition,
        editionRootId: rootId,
        path: value.canonicalPath,
        checksum: value.checksum,
        sizeBytes: BigInt(value.sizeBytes),
        properties: {},
        state: "published",
        owned: true,
        ownershipEpoch: 0,
      };
    }),
  });
  await db.assetCoverage.createMany({
    data: groups.flatMap((group) =>
      group.associations.map((row) => ({
        assetId: row.value.group.assetId,
        mediaId: row.value.scope.mediaId,
        edition,
        current: true,
      })),
    ),
  });
  await db.plexAssociationEvidence.createMany({
    data: groups.flatMap((group) =>
      group.associations.map((row) => ({
        id: row.id,
        ...row.value.scope,
        assetId: row.value.group.assetId,
        serverMachineId: server,
        associationHash: row.hash,
        evidence: row.value,
      })),
    ),
  });
  return groups;
}

export async function insertClaims(tx: Tx, groups: Group[]) {
  const now = new Date();
  await tx.plexClaimGroup.createMany({
    data: groups.map((group) => ({
      id: group.id,
      serverMachineId: first(group).value.access.serverMachineId,
      groupHash: identityHash(first(group).value.group),
      group: first(group).value.group,
    })),
  });
  await tx.plexClaimGroupMember.createMany({
    data: groups.flatMap((group) =>
      group.associations.map((row) => ({
        groupId: group.id,
        ...row.value.scope,
        evidenceId: row.id,
        associationHash: row.hash,
      })),
    ),
  });
  await tx.plexItemClaim.createMany({
    data: groups.flatMap((group) =>
      group.associations.map((row) => ({
        groupId: group.id,
        ...row.value.scope,
        evidenceId: row.id,
        associationHash: row.hash,
        serverMachineId: row.value.access.serverMachineId,
        sectionId: row.value.access.sectionId,
        ratingKey: row.value.item.ratingKey,
      })),
    ),
  });
  await tx.plexPartClaim.createMany({
    data: groups.map((group) => {
      const value = first(group).value;
      return {
        groupId: group.id,
        serverMachineId: value.access.serverMachineId,
        partId: value.item.media[0].parts[0].id,
        canonicalPath: value.group.canonicalPath,
      };
    }),
  });
  await tx.plexPathClaim.createMany({
    data: groups.map((group) => {
      const value = first(group).value;
      return {
        groupId: group.id,
        serverMachineId: value.access.serverMachineId,
        canonicalPath: value.group.canonicalPath,
        canonicalPathHash: plexCanonicalPathHash(value.group.canonicalPath),
      };
    }),
  });
  await tx.plexBindingCurrent.createMany({
    data: groups.flatMap((group) =>
      group.associations.map((row) => ({
        ...row.value.scope,
        evidenceId: row.id,
        associationHash: row.hash,
        revision: 1,
        verifiedStartedAt: now,
        verifiedCompletedAt: now,
      })),
    ),
  });
}

export async function commitClaims(db: Database, groups: Group[]) {
  await db.$transaction(async (tx) => {
    await bindPlexTransactionDeadline(tx, freshness());
    await insertClaims(tx, groups);
    expect(await tx.plexClaimValidation.count()).toBe(groups.length);
  });
  expect(await db.plexClaimValidation.count()).toBe(0);
}

export async function snapshot(db: Database, groups: Group[]) {
  const where = { groupId: { in: groups.map((group) => group.id) } };
  return {
    groups: await db.plexClaimGroup.findMany({
      where: { id: where.groupId },
      orderBy: { id: "asc" },
    }),
    members: await db.plexClaimGroupMember.findMany({
      where,
      orderBy: { mediaId: "asc" },
    }),
    items: await db.plexItemClaim.findMany({
      where,
      orderBy: { mediaId: "asc" },
    }),
    parts: await db.plexPartClaim.findMany({
      where,
      orderBy: { partId: "asc" },
    }),
    paths: await db.plexPathClaim.findMany({
      where,
      orderBy: { canonicalPath: "asc" },
    }),
    pointers: await db.plexBindingCurrent.findMany({
      where: {
        mediaId: {
          in: groups.flatMap((group) =>
            group.associations.map((row) => row.value.scope.mediaId),
          ),
        },
      },
      orderBy: { mediaId: "asc" },
    }),
  };
}

export async function removeClaims(tx: Tx, group: Group) {
  const where = { groupId: group.id };
  await tx.plexItemClaim.deleteMany({ where });
  await tx.plexClaimGroupMember.deleteMany({ where });
  await tx.plexPartClaim.deleteMany({ where });
  await tx.plexPathClaim.deleteMany({ where });
  await tx.plexClaimGroup.delete({ where: { id: group.id } });
}
