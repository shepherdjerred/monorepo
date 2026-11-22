import type { Prisma } from "#generated/prisma/client.ts";
import type { LibraryQuery } from "#shared/household/library.ts";
import {
  libraryFollowingWhere,
  libraryPolicyWhere,
} from "#infrastructure/library/views/policy.ts";
import { leavingSoonWhere } from "#infrastructure/library/views/leaving.ts";
import {
  anyEpisode,
  type SeriesEpisodeCounts,
} from "#infrastructure/library/views/series-episodes.ts";

type Where = Prisma.MediaItemWhereInput;

/** A file in a registered external Plex library; whether it is present is proved later. */
const externalFile = {
  assets: {
    some: { current: true, edition: "default", asset: { owned: false } },
  },
} satisfies Where;
/** The episode rollup leaves specials (season 0) out; so does this. */
const regularSeason = {
  OR: [{ seasonNumber: null }, { seasonNumber: { not: 0 } }],
} satisfies Where;
const availableEpisode = {
  kind: "episode",
  availability: "available",
  ...regularSeason,
} satisfies Where;

/**
 * Every title `libraryAvailabilityMatches` can accept, and some it rejects: an
 * external file counts here before it is proved present.
 */
function availabilitySupersetWhere(
  availability: "available" | "unavailable",
): Where {
  if (availability === "available")
    return {
      OR: [
        {
          kind: "movie",
          OR: [{ availability: "available" }, externalFile],
        },
        {
          kind: "series",
          OR: [
            anyEpisode(availableEpisode),
            anyEpisode({ kind: "episode", ...externalFile }),
          ],
        },
      ],
    };
  return {
    OR: [
      { kind: "movie", availability: { not: "available" } },
      { kind: "series", NOT: anyEpisode(availableEpisode) },
    ],
  };
}

/** The household-library titles a query asks for, before cursor and visibility. */
export function libraryWhere(
  query: LibraryQuery,
  actorId: string,
  membership: Where,
): Where {
  return {
    AND: [
      {
        kind: query.kind === "all" ? { in: ["movie", "series"] } : query.kind,
      },
      query.query === ""
        ? {}
        : { title: { contains: query.query, mode: "insensitive" } },
      membership,
      query.policy === "all" ? {} : libraryPolicyWhere(query.policy),
      query.mine === "all" ? {} : libraryFollowingWhere(actorId),
      query.leaving === "all" ? {} : leavingSoonWhere,
      query.availability === "all"
        ? {}
        : availabilitySupersetWhere(query.availability),
    ],
  };
}

/**
 * Whether a listed title is in the asked-for availability. A movie is
 * available when the view shows it `available`, proved external presence
 * included. A series is available when its rollup counts an available episode
 * or is unknown because an external library covers it.
 */
export function libraryAvailabilityMatches(
  filter: LibraryQuery["availability"],
  item: {
    kind: "movie" | "series";
    availability: string | null;
    episodes: SeriesEpisodeCounts | null;
  },
): boolean {
  if (filter === "all") return true;
  const available =
    item.kind === "movie"
      ? item.availability === "available"
      : item.episodes === null || item.episodes.available > 0;
  return available === (filter === "available");
}
