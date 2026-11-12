import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { CatalogIdentitySchema } from "#shared/acquisition/catalog.ts";
import { matchesReferences } from "#shared/plex-binding/canonical.ts";
import { canonicalRootId } from "#infrastructure/editions/locks.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { ExternalPlexObservation } from "./contract.ts";

const hierarchy = {
  parent: { include: { parent: true } },
} satisfies Prisma.MediaItemInclude;
type CanonicalMedia = Prisma.MediaItemGetPayload<{ include: typeof hierarchy }>;

async function memberFor(
  tx: Prisma.TransactionClient,
  root: CanonicalMedia,
  member: ExternalPlexObservation["members"][number],
) {
  const candidates =
    root.kind === "movie"
      ? [root]
      : await tx.mediaItem.findMany({
          where: {
            kind: "episode",
            seasonNumber: member.seasonNumber,
            episodeNumber: member.episodeNumber,
            OR: [
              { parentId: root.id },
              { parent: { kind: "season", parentId: root.id } },
            ],
          },
          include: hierarchy,
          take: 2,
        });
  const media = candidates[0];
  if (media === undefined || candidates.length !== 1)
    throw new MediaError(
      "external_library_catalog_required",
      "Refresh the canonical series catalog before registering this exact episode",
      409,
    );
  if (canonicalRootId(media) !== root.id)
    throw new MediaError(
      "external_library_identity_changed",
      "Canonical episode ancestry changed",
      409,
    );
  const external = z.record(z.string(), z.json()).parse(media.externalIds);
  if (
    media.kind === "episode" &&
    (media.tmdbId === null ||
      !matchesReferences(member.guids, [
        { namespace: "tmdb", value: String(media.tmdbId) },
      ]))
  )
    throw new MediaError(
      "external_library_identity_changed",
      "Plex must expose a matching TMDB episode GUID for its exact canonical coordinate",
      409,
    );
  return {
    mediaId: media.id,
    version: media.version,
    parentId: media.parentId,
    seasonNumber: media.seasonNumber,
    episodeNumber: media.episodeNumber,
    externalIdentityHash: identityHash(external),
  };
}

/** Canonical catalog rows come from catalog.adopt/refresh, never a guessed filename. */
export async function externalCatalog(
  tx: Prisma.TransactionClient,
  observed: ExternalPlexObservation,
) {
  const root = await tx.mediaItem.findUnique({
    where: {
      kind_tmdbId: { kind: observed.root.kind, tmdbId: observed.root.tmdbId },
    },
    include: hierarchy,
  });
  if (root === null)
    throw new MediaError(
      "external_library_catalog_required",
      `Add canonical ${observed.root.kind} TMDB ${String(observed.root.tmdbId)} through catalog adoption before registration`,
      409,
    );
  const catalog = z
    .object({ catalogIdentity: CatalogIdentitySchema })
    .parse(root.externalIds).catalogIdentity;
  if (
    !matchesReferences(observed.root.guids, catalog.references) ||
    !catalog.references.some(
      (ref) =>
        ref.kind === root.kind &&
        ref.namespace === "tmdb" &&
        ref.value === String(root.tmdbId),
    ) ||
    (observed.root.year !== null && root.year !== observed.root.year)
  )
    throw new MediaError(
      "external_library_identity_changed",
      "Plex root GUIDs or year conflict with the canonical catalog",
      409,
    );
  const members = [];
  for (const member of observed.members)
    members.push(await memberFor(tx, root, member));
  if (new Set(members.map((member) => member.mediaId)).size !== members.length)
    throw new MediaError(
      "external_library_identity_changed",
      "Plex has ambiguous duplicate coverage for one canonical episode",
      409,
    );
  return { root, catalog, members };
}
