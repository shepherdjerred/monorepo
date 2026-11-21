import type { MediaActor } from "#application/auth.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  libraryCursor,
  LibraryPageSchema,
  LibraryQuerySchema,
  type LibraryQuery,
} from "#shared/household/library.ts";
import type { Database } from "#infrastructure/database.ts";
import { repeatableRead } from "#infrastructure/locks.ts";
import { visibilityReader } from "#infrastructure/visibility/access.ts";
import { externalAvailableMediaIds } from "#infrastructure/external-library/availability.ts";
import {
  libraryInterest,
  libraryViewInclude,
  libraryViewPolicy,
} from "#infrastructure/library/views/policy.ts";
import {
  libraryAvailability,
  permittedPlexAccess,
  type LibraryReadSettings,
} from "#infrastructure/library/views/plex-access.ts";
import { rootArtwork } from "#infrastructure/library/views/artwork.ts";
import { seriesEpisodeCounts } from "#infrastructure/library/views/series-episodes.ts";
import { readLeavingSoon } from "#infrastructure/library/views/leaving.ts";
import {
  libraryAvailabilityMatches,
  libraryWhere,
} from "#infrastructure/library/views/library-filters.ts";
import {
  libraryAddedAt,
  libraryAddedPage,
} from "#infrastructure/library/views/library-added.ts";

type LibraryMedia = Prisma.MediaItemGetPayload<{
  include: typeof libraryViewInclude;
}>;
type LibraryRows = {
  rows: LibraryMedia[];
  /** Already known when the page was ordered by it. */
  addedAt: ReadonlyMap<string, Date> | null;
  nextCursor: string | null;
};
type Cursor = ReturnType<typeof libraryCursor>;

export class PrismaLibraryApplication {
  constructor(
    private readonly db: Database,
    private readonly settings: LibraryReadSettings,
  ) {}

  list(actor: MediaActor, raw: LibraryQuery) {
    const query = LibraryQuerySchema.parse(raw);
    const cursor = libraryCursor(query);
    return repeatableRead(this.db, async (tx) => {
      const reader = await visibilityReader(tx, actor, this.settings);
      const where = libraryWhere(query, actor.id);
      const page =
        cursor.sort === "title"
          ? await titlePage(tx, where, { after: cursor.after, query })
          : await addedPage(tx, where, { after: cursor.after, query });
      const visible = page.rows.filter((media) => reader.visible(media));
      const idsOf = (kind: "movie" | "series") =>
        visible.filter((media) => media.kind === kind).map((media) => media.id);
      const ids = visible.map((media) => media.id);
      const external = await externalAvailableMediaIds(
        tx,
        idsOf("movie"),
        permittedPlexAccess(this.settings, reader.user),
      );
      const episodes = await seriesEpisodeCounts(tx, idsOf("series"));
      const leavingSoon = await readLeavingSoon(tx, ids);
      const addedAt = page.addedAt ?? (await libraryAddedAt(tx, ids));
      return LibraryPageSchema.parse({
        items: visible
          .map((media) => {
            if (media.kind !== "movie" && media.kind !== "series")
              throw new Error("Library page read a row that is not a title");
            const policy = libraryViewPolicy(media, actor.id);
            const target = media.intents.find(
              (intent) => intent.edition === "default",
            );
            const leaving = leavingSoon(media.id);
            return {
              id: media.id,
              title: media.title,
              kind: media.kind,
              year: media.year,
              artwork: rootArtwork(media),
              ...libraryPolicyLabels(policy),
              myInterest: libraryInterest(media, policy, actor.id),
              availability: libraryAvailability(media, external),
              episodes: media.kind === "series" ? episodes(media.id) : null,
              addedAt: addedAt.get(media.id)?.toISOString() ?? null,
              leavingSoon:
                leaving === null
                  ? null
                  : {
                      state: leaving.state,
                      graceUntil: leaving.graceUntil?.toISOString() ?? null,
                    },
              libraryKeeping:
                target !== undefined && reader.owner
                  ? {
                      mediaVersion: media.version,
                      targetVersion: target.version,
                      keepingPolicy: target.libraryKeep ? "keep" : "temporary",
                    }
                  : null,
            };
          })
          .filter((item) =>
            libraryAvailabilityMatches(query.availability, item),
          ),
        nextCursor: page.nextCursor,
      });
    });
  }
}

/** Every matching title, A to Z. */
async function titlePage(
  tx: Prisma.TransactionClient,
  where: Prisma.MediaItemWhereInput,
  page: {
    after: Extract<Cursor, { sort: "title" }>["after"];
    query: LibraryQuery;
  },
): Promise<LibraryRows> {
  const { after } = page;
  const { limit } = page.query;
  const rows = await tx.mediaItem.findMany({
    where: {
      AND: [
        where,
        after === null
          ? {}
          : {
              OR: [
                { title: { gt: after.title } },
                { title: after.title, id: { gt: after.id } },
              ],
            },
      ],
    },
    include: libraryViewInclude,
    orderBy: [{ title: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
  const listed = rows.slice(0, limit);
  const last = listed.at(-1);
  return {
    rows: listed,
    addedAt: null,
    nextCursor:
      last !== undefined && rows.length > limit
        ? JSON.stringify({ title: last.title, id: last.id })
        : null,
  };
}

/**
 * The matching titles that have something to play, newest first. The filters
 * stay in one place, the `where` both sorts share: the matching titles are
 * named first and the keyset query then orders only those.
 */
async function addedPage(
  tx: Prisma.TransactionClient,
  where: Prisma.MediaItemWhereInput,
  page: {
    after: Extract<Cursor, { sort: "added" }>["after"];
    query: LibraryQuery;
  },
): Promise<LibraryRows> {
  const { limit } = page.query;
  const matching = await tx.mediaItem.findMany({
    where,
    select: { id: true },
  });
  const ordered = await libraryAddedPage(
    tx,
    matching.map((media) => media.id),
    { after: page.after, take: limit + 1 },
  );
  const listed = ordered.slice(0, limit);
  const last = listed.at(-1);
  const rows = await tx.mediaItem.findMany({
    where: { id: { in: listed.map((entry) => entry.id) } },
    include: libraryViewInclude,
  });
  return {
    rows: listed.map((entry) => {
      const media = rows.find((row) => row.id === entry.id);
      if (media === undefined)
        throw new Error("Library page lost a title between its two reads");
      return media;
    }),
    addedAt: new Map(listed.map((entry) => [entry.id, entry.addedAt])),
    nextCursor:
      last !== undefined && ordered.length > limit
        ? JSON.stringify({ addedAt: last.addedAt.toISOString(), id: last.id })
        : null,
  };
}

function libraryPolicyLabels(policy: ReturnType<typeof libraryViewPolicy>) {
  if (policy.kept) return { policy: "keep", protection: "keep_indefinitely" };
  return policy.householdFollowing
    ? { policy: "temporary", protection: "temporary_interest" }
    : { policy: "unclassified", protection: "review_required" };
}
