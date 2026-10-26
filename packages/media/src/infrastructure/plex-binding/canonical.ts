import { z } from "zod";
import type { MediaItem, Prisma } from "#generated/prisma/client.ts";
import { CatalogIdentitySchema } from "#shared/acquisition/catalog.ts";
import type { NativeStoredScopeSchema } from "#shared/native-recovery/lifecycle.ts";
import {
  PlexCanonicalTargetSchema,
  type PlexCanonicalTarget,
} from "#shared/plex-binding/canonical.ts";
import {
  type PlexBindingScope,
  plexScopeKey,
  plexSortedUnique,
} from "#shared/plex-binding/contract.ts";
import { canonicalReferences } from "#infrastructure/acquisition-identity/references.ts";
import {
  fullSeriesNumberingDigest,
  identityHash,
  numberingOf,
} from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalRootId } from "#infrastructure/editions/locks.ts";
import { PlexBindingProtection } from "./errors.ts";

type Leaf = Prisma.MediaItemGetPayload<{
  include: { parent: { include: { parent: true } } };
}>;

function rootOf(row: Leaf): MediaItem {
  if (row.kind === "movie") return row;
  const root = row.parent?.kind === "series" ? row.parent : row.parent?.parent;
  if (
    row.kind !== "episode" ||
    root?.kind !== "series" ||
    root.catalogState !== "ready"
  )
    throw new PlexBindingProtection("unresolved_identity");
  return root;
}

function rootIdentity(root: MediaItem): string {
  return identityHash({
    references: canonicalReferences(root).references,
    id: root.id,
    kind: root.kind,
    tmdbId: root.tmdbId,
    title: root.title,
    year: root.year,
    catalogIdentity:
      z
        .object({ catalogIdentity: CatalogIdentitySchema.optional() })
        .parse(root.externalIds).catalogIdentity ?? null,
  });
}

async function seriesNumbering(
  tx: Prisma.TransactionClient,
  root: MediaItem,
): Promise<string> {
  const episodes = await tx.mediaItem.findMany({
    where: {
      kind: "episode",
      OR: [{ parentId: root.id }, { parent: { parentId: root.id } }],
    },
    orderBy: { id: "asc" },
    take: 10_001,
  });
  if (
    episodes.length === 0 ||
    episodes.length > 10_000 ||
    episodes.some(
      (row) =>
        row.catalogState !== "ready" ||
        row.seasonNumber === null ||
        row.episodeNumber === null,
    )
  )
    throw new PlexBindingProtection("unresolved_numbering");
  const coordinates = episodes.map(
    (row) => `${String(row.seasonNumber)}:${String(row.episodeNumber)}`,
  );
  const absolute = episodes.flatMap((row) => {
    const value = numberingOf(row).absoluteNumber;
    return value === null ? [] : [value];
  });
  if (
    new Set(coordinates).size !== coordinates.length ||
    new Set(absolute).size !== absolute.length
  )
    throw new PlexBindingProtection("unresolved_numbering");
  return fullSeriesNumberingDigest(root, episodes);
}

/** One canonical projection for expected capture and both complete verifier passes. */
export async function readPlexCanonicalTargets(
  tx: Prisma.TransactionClient,
  scopes: readonly PlexBindingScope[],
): Promise<PlexCanonicalTarget[]> {
  if (
    scopes.length === 0 ||
    scopes.length > 10_000 ||
    !plexSortedUnique(scopes.map((scope) => plexScopeKey(scope)))
  )
    throw new PlexBindingProtection("scope_changed");
  const ids = [...new Set(scopes.map((scope) => scope.mediaId))];
  const rows = await tx.mediaItem.findMany({
    where: { id: { in: ids } },
    include: { parent: { include: { parent: true } } },
    orderBy: { id: "asc" },
  });
  if (rows.length !== ids.length)
    throw new PlexBindingProtection("scope_changed");
  const byId = new Map(rows.map((row) => [row.id, row]));
  const roots = new Map(
    rows.map((row) => {
      const root = rootOf(row);
      return [root.id, root];
    }),
  );
  const hashes = new Map<
    string,
    { canonicalIdentityHash: string; numberingHash: string }
  >();
  for (const root of roots.values()) {
    if (canonicalReferences(root).references.length === 0)
      throw new PlexBindingProtection("unresolved_identity");
    hashes.set(root.id, {
      canonicalIdentityHash: rootIdentity(root),
      numberingHash:
        root.kind === "series"
          ? await seriesNumbering(tx, root)
          : identityHash({ kind: "movie", rootMediaId: root.id }),
    });
  }
  return scopes.map((scope) => {
    const row = byId.get(scope.mediaId);
    if (row === undefined) throw new Error("Captured canonical leaf missing");
    const root = rootOf(row),
      hash = hashes.get(root.id);
    if (hash === undefined || canonicalRootId(row) !== root.id)
      throw new Error("Captured canonical root missing");
    return PlexCanonicalTargetSchema.parse({
      scope,
      canonicalRootId: root.id,
      references: canonicalReferences(root).references,
      ...hash,
      kind: row.kind,
      ...(row.kind === "movie"
        ? {}
        : {
            coordinate: {
              mediaId: row.id,
              mediaVersion: row.version,
              seriesId: root.id,
              seasonNumber: row.seasonNumber,
              episodeNumber: row.episodeNumber,
              tmdbEpisodeId: row.tmdbId,
              ...numberingOf(row),
            },
          }),
    });
  });
}

/** Native review keeps its original scope; no current-binding or ownership bootstrap. */
export async function readNativePlexCanonicalTargets(
  tx: Prisma.TransactionClient,
  scope: z.infer<typeof NativeStoredScopeSchema>,
): Promise<PlexCanonicalTarget[]> {
  const rows = await tx.mediaItem.findMany({
    where: { id: { in: scope.media.map((row) => row.id) } },
    include: { parent: { include: { parent: true } } },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const reviewed of scope.media) {
    const row = byId.get(reviewed.id);
    if (
      row === undefined ||
      identityHash(nativeIdentity(row)) !==
        identityHash(nativeIdentity(reviewed))
    )
      throw new PlexBindingProtection("scope_changed");
  }
  return readPlexCanonicalTargets(
    tx,
    scope.media
      .map((row) => ({ mediaId: row.id, edition: "default" as const }))
      .sort((a, b) => plexScopeKey(a).localeCompare(plexScopeKey(b))),
  );
}

type Identity = { id: string; tmdbId: number | null; externalIds: unknown };
function nativeIdentity(
  row: Identity & {
    kind: string;
    seasonNumber: number | null;
    episodeNumber: number | null;
    parent: (Identity & { parent: Identity | null }) | null;
  },
) {
  const identity = (value: Identity) => ({
    id: value.id,
    tmdbId: value.tmdbId,
    externalIds: value.externalIds,
  });
  return {
    ...identity(row),
    kind: row.kind,
    seasonNumber: row.seasonNumber,
    episodeNumber: row.episodeNumber,
    parent:
      row.parent === null
        ? null
        : {
            ...identity(row.parent),
            parent:
              row.parent.parent === null ? null : identity(row.parent.parent),
          },
  };
}
