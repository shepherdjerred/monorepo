import type { MediaActor } from "#application/auth.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  LibraryCursorSchema,
  LibraryPageSchema,
  LibraryQuerySchema,
  type LibraryQuery,
} from "#shared/household/library.ts";
import { PlexAccessSchema } from "#shared/plex-binding/contract.ts";
import type { Database } from "#infrastructure/database.ts";
import { repeatableRead } from "#infrastructure/locks.ts";
import { visibilityReader } from "#infrastructure/visibility/access.ts";
import { externalAvailableMediaIds } from "#infrastructure/external-library/availability.ts";
import {
  libraryViewInclude,
  libraryViewPolicy,
} from "#infrastructure/library/views/policy.ts";
import type { CalendarReadSettings } from "#infrastructure/library/views/calendar.ts";

export class PrismaLibraryApplication {
  constructor(
    private readonly db: Database,
    private readonly settings: CalendarReadSettings,
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
            {
              OR: [
                { intents: { some: { libraryKeep: true } } },
                { requests: { some: { active: true, excluded: false } } },
                { assets: { some: { current: true } } },
              ],
            },
          ],
        },
        include: libraryViewInclude,
        orderBy: [{ title: "asc" }, { id: "asc" }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const visible = page.filter((media) => reader.visible(media));
      const access = ["movie", "series"].flatMap((kind) => {
        const sectionId =
          kind === "movie"
            ? this.settings.sections?.movie
            : this.settings.sections?.series;
        return sectionId === undefined ||
          this.settings.serverMachineId === undefined ||
          reader.user.plexIdentity?.permittedSectionIds.includes(sectionId) !==
            true
          ? []
          : [
              PlexAccessSchema.parse({
                serverMachineId: this.settings.serverMachineId,
                sectionId,
                sectionType: kind === "movie" ? "movie" : "show",
              }),
            ];
      });
      const external = await externalAvailableMediaIds(
        tx,
        visible
          .filter((media) => media.kind === "movie")
          .map((media) => media.id),
        access,
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
            ...libraryPolicyLabels(policy),
            myInterest: policy.following
              ? "following"
              : media.requests.some((claim) => claim.userId === actor.id)
                ? "released"
                : "none",
            availability:
              media.kind === "series"
                ? null
                : external.has(media.id)
                  ? "available"
                  : media.availability,
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
