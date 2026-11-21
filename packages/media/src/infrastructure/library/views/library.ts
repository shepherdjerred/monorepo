import type { MediaActor } from "#application/auth.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  LibraryCursorSchema,
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
  libraryMemberWhere,
  libraryViewInclude,
  libraryViewPolicy,
} from "#infrastructure/library/views/policy.ts";
import {
  libraryAvailability,
  permittedPlexAccess,
  type LibraryReadSettings,
} from "#infrastructure/library/views/plex-access.ts";
import { rootArtwork } from "#infrastructure/library/views/artwork.ts";

export class PrismaLibraryApplication {
  constructor(
    private readonly db: Database,
    private readonly settings: LibraryReadSettings,
  ) {}

  list(actor: MediaActor, raw: LibraryQuery) {
    const query = LibraryQuerySchema.parse(raw);
    const cursor =
      query.cursor === null
        ? null
        : LibraryCursorSchema.parse(JSON.parse(query.cursor));
    return repeatableRead(this.db, async (tx) => {
      const reader = await visibilityReader(tx, actor, this.settings);
      const after: Prisma.MediaItemWhereInput =
        cursor === null
          ? {}
          : {
              OR: [
                { title: { gt: cursor.title } },
                { title: cursor.title, id: { gt: cursor.id } },
              ],
            };
      const rows = await tx.mediaItem.findMany({
        where: {
          AND: [
            {
              kind:
                query.kind === "all" ? { in: ["movie", "series"] } : query.kind,
            },
            query.query === ""
              ? {}
              : { title: { contains: query.query, mode: "insensitive" } },
            after,
            libraryMemberWhere,
          ],
        },
        include: libraryViewInclude,
        orderBy: [{ title: "asc" }, { id: "asc" }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const visible = page.filter((media) => reader.visible(media));
      const external = await externalAvailableMediaIds(
        tx,
        visible
          .filter((media) => media.kind === "movie")
          .map((media) => media.id),
        permittedPlexAccess(this.settings, reader.user),
      );
      return LibraryPageSchema.parse({
        items: visible.map((media) => {
          const policy = libraryViewPolicy(media, actor.id);
          const target = media.intents.find(
            (intent) => intent.edition === "default",
          );
          return {
            id: media.id,
            title: media.title,
            kind: media.kind,
            year: media.year,
            artwork: rootArtwork(media),
            ...libraryPolicyLabels(policy),
            myInterest: libraryInterest(media, policy, actor.id),
            availability: libraryAvailability(media, external),
            libraryKeeping:
              target !== undefined && reader.owner
                ? {
                    mediaVersion: media.version,
                    targetVersion: target.version,
                    keepingPolicy: target.libraryKeep ? "keep" : "temporary",
                  }
                : null,
          };
        }),
        nextCursor:
          last !== undefined && rows.length > query.limit
            ? JSON.stringify({ title: last.title, id: last.id })
            : null,
      });
    });
  }
}

function libraryPolicyLabels(policy: ReturnType<typeof libraryViewPolicy>) {
  if (policy.kept) return { policy: "keep", protection: "keep_indefinitely" };
  return policy.householdFollowing
    ? { policy: "temporary", protection: "temporary_interest" }
    : { policy: "unclassified", protection: "review_required" };
}
