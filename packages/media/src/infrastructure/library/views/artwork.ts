import type { Prisma } from "#generated/prisma/client.ts";
import type { Artwork } from "#shared/artwork/contract.ts";

type Node = { parentId: string | null };
type ArtworkNode = Node & {
  posterPath: string | null;
  backdropPath: string | null;
};

const artworkFields = {
  id: true,
  parentId: true,
  posterPath: true,
  backdropPath: true,
} as const;
/** The narrowest selection that lets a list row name its root title and its art. */
export const artworkAncestrySelect = {
  ...artworkFields,
  parent: {
    select: { ...artworkFields, parent: { select: artworkFields } },
  },
} as const satisfies Prisma.MediaItemSelect;

/**
 * The movie or series a row belongs to: itself, its parent, or its
 * grandparent. Both ancestors must have been loaded; a row that still names a
 * parent after that walk was read without its ancestry, or sits deeper than a
 * series, season and episode, and neither may pass as a root.
 */
export function rootMedia<
  Leaf extends Node,
  Parent extends Node,
  Root extends Node,
>(
  media: Leaf & { parent: (Parent & { parent: Root | null }) | null },
): Leaf | Parent | Root {
  const root = media.parent?.parent ?? media.parent ?? media;
  if (root.parentId !== null)
    throw new Error("Media ancestry was not loaded up to its root title");
  return root;
}

/** Seasons and episodes store no art of their own; every row shows its root title's. */
export function rootArtwork(
  media: ArtworkNode & {
    parent: (ArtworkNode & { parent: ArtworkNode | null }) | null;
  },
): Artwork {
  const root = rootMedia(media);
  return { posterPath: root.posterPath, backdropPath: root.backdropPath };
}

type NamedNode = ArtworkNode & { id: string; title: string };

/**
 * How a list row names and shows the movie or series it belongs to, from the
 * ancestry the row was already read with. A root row names itself.
 */
export function rootReference(
  media: NamedNode & {
    parent: (NamedNode & { parent: NamedNode | null }) | null;
  },
): { rootMediaId: string; rootTitle: string; artwork: Artwork } {
  const root = rootMedia(media);
  return {
    rootMediaId: root.id,
    rootTitle: root.title,
    artwork: rootArtwork(media),
  };
}
