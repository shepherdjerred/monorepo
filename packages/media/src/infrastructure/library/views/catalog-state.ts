import type { MediaActor } from "#application/auth.ts";
import type {
  CatalogLibraryState,
  LibraryAccess,
} from "#shared/catalog/contract.ts";
import type { Database } from "#infrastructure/database.ts";
import { repeatableRead } from "#infrastructure/locks.ts";
import { assessVisibilityAccess } from "#infrastructure/visibility/access.ts";
import { externalAvailableMediaIds } from "#infrastructure/external-library/availability.ts";
import {
  libraryInterest,
  libraryMemberWhere,
  libraryViewInclude,
  libraryViewPolicy,
} from "#infrastructure/library/views/policy.ts";
import {
  libraryAvailability,
  permittedPlexAccess,
  type LibraryReadSettings,
} from "#infrastructure/library/views/plex-access.ts";
import { seriesEpisodeCounts } from "#infrastructure/library/views/series-episodes.ts";

export type CatalogTitle = { kind: "movie" | "series"; externalId: number };
export type CatalogLibraryRead = {
  libraryAccess: LibraryAccess;
  /** Null when the household does not have the title or the actor may not see it. */
  state: (title: CatalogTitle) => CatalogLibraryState | null;
};

function key(title: CatalogTitle): string {
  return `${title.kind}:${String(title.externalId)}`;
}

/**
 * What the household has of a page of catalog titles, as `GET /library` would
 * describe the same titles to this actor. One exact lookup on the
 * `(kind, tmdbId)` key covers the page; nothing is read per title.
 *
 * Unlike the library, a reader whose Plex access is stale is not refused: the
 * catalog itself is still theirs to browse, so the page is returned with no
 * title marked and `libraryAccess: "stale"`.
 */
export function readCatalogLibraryState(
  db: Database,
  settings: LibraryReadSettings,
  actor: MediaActor,
  titles: readonly CatalogTitle[],
): Promise<CatalogLibraryRead> {
  return repeatableRead(db, async (tx) => {
    const { reader, user } = await assessVisibilityAccess(tx, actor, settings);
    if (reader === null) return { libraryAccess: "stale", state: () => null };
    const tmdbIds = (kind: CatalogTitle["kind"]) => [
      ...new Set(
        titles
          .filter((title) => title.kind === kind)
          .map((title) => title.externalId),
      ),
    ];
    const rows =
      titles.length === 0
        ? []
        : await tx.mediaItem.findMany({
            where: {
              AND: [
                {
                  OR: [
                    { kind: "movie", tmdbId: { in: tmdbIds("movie") } },
                    { kind: "series", tmdbId: { in: tmdbIds("series") } },
                  ],
                },
                libraryMemberWhere,
              ],
            },
            include: libraryViewInclude,
          });
    const visible = rows.filter((media) => reader.visible(media));
    const idsOf = (kind: CatalogTitle["kind"]) =>
      visible.filter((media) => media.kind === kind).map((media) => media.id);
    const external = await externalAvailableMediaIds(
      tx,
      idsOf("movie"),
      permittedPlexAccess(settings, user),
    );
    const episodes = await seriesEpisodeCounts(tx, idsOf("series"));
    const states = new Map<string, CatalogLibraryState>();
    for (const media of visible) {
      if (
        media.tmdbId === null ||
        (media.kind !== "movie" && media.kind !== "series")
      )
        throw new Error("Catalog lookup returned a row outside its key");
      const policy = libraryViewPolicy(media, actor.id);
      states.set(key({ kind: media.kind, externalId: media.tmdbId }), {
        mediaId: media.id,
        availability: libraryAvailability(media, external),
        episodes: media.kind === "series" ? episodes(media.id) : null,
        requested: policy.householdFollowing,
        myInterest: libraryInterest(media, policy, actor.id),
      });
    }
    return {
      libraryAccess: "current",
      state: (title) => states.get(key(title)) ?? null,
    };
  });
}
