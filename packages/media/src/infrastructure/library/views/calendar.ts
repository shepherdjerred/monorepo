import type { MediaActor } from "#application/auth.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  CalendarPageSchema,
  CalendarQuerySchema,
  CalendarCursorSchema,
  type CalendarQuery,
} from "#shared/household/calendar.ts";
import type { Database } from "#infrastructure/database.ts";
import { repeatableRead } from "#infrastructure/locks.ts";
import {
  visibilityReader,
  type VisibilitySections,
} from "#infrastructure/visibility/access.ts";
import {
  libraryViewInclude,
  libraryViewPolicy,
} from "#infrastructure/library/views/policy.ts";
import { externalAvailableMediaIds } from "#infrastructure/external-library/availability.ts";
import { PlexAccessSchema } from "#shared/plex-binding/contract.ts";

export type CalendarReadSettings = {
  serverMachineId?: string | undefined;
  sections?: Partial<VisibilitySections> | undefined;
};

export class PrismaCalendarApplication {
  constructor(
    private readonly db: Database,
    private readonly settings: CalendarReadSettings,
  ) {}

  list(actor: MediaActor, raw: CalendarQuery) {
    const query = CalendarQuerySchema.parse(raw);
    const cursor =
      query.cursor === null
        ? null
        : CalendarCursorSchema.parse(JSON.parse(query.cursor));
    return repeatableRead(this.db, async (tx) => {
      const reader = await visibilityReader(tx, actor, this.settings);
      const request = {
        active: true,
        excluded: false,
        interestState: "following" as const,
        ...(reader.owner ? {} : { userId: actor.id }),
      };
      const requested: Prisma.MediaItemWhereInput = {
        requests: { some: request },
      };
      const kept: Prisma.MediaItemWhereInput = {
        OR: [
          { intents: { some: { libraryKeep: true } } },
          {
            requests: {
              some: { active: true, excluded: false, keepingPolicy: "keep" },
            },
          },
        ],
      };
      const scopes = [requested, kept];
      const scope: Prisma.MediaItemWhereInput = {
        OR: scopes.flatMap((where) => [
          where,
          { parent: where },
          { parent: { parent: where } },
        ]),
      };
      const after: Prisma.MediaReleaseDateWhereInput =
        cursor === null
          ? {}
          : cursor.date === null
            ? { date: null, id: { gt: cursor.id } }
            : {
                OR: [
                  { date: { gt: cursor.date } },
                  { date: cursor.date, id: { gt: cursor.id } },
                  { date: null },
                ],
              };
      const rows = await tx.mediaReleaseDate.findMany({
        where: {
          AND: [
            {
              OR: [
                { date: { gte: query.from, lte: query.to } },
                { date: null },
              ],
            },
            after,
            { media: scope },
            query.kind === "all" ? {} : { kind: query.kind },
          ],
        },
        include: { media: { include: libraryViewInclude } },
        orderBy: [{ date: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const visible = page.filter((row) => {
        const policy = libraryViewPolicy(row.media, actor.id);
        return (
          reader.visible(row.media) &&
          (policy.kept ||
            policy.following ||
            (reader.owner && policy.householdFollowing))
        );
      });
      const external = await externalAvailableMediaIds(
        tx,
        visible.map((row) => row.mediaId),
        ["movie", "series"].flatMap((kind) => {
          const sectionId =
            kind === "movie"
              ? this.settings.sections?.movie
              : this.settings.sections?.series;
          return sectionId === undefined ||
            this.settings.serverMachineId === undefined ||
            reader.user.plexIdentity?.permittedSectionIds.includes(
              sectionId,
            ) !== true
            ? []
            : [
                PlexAccessSchema.parse({
                  serverMachineId: this.settings.serverMachineId,
                  sectionId,
                  sectionType: kind === "movie" ? "movie" : "show",
                }),
              ];
        }),
      );
      return CalendarPageSchema.parse({
        events: visible
          .map((row) => {
            const media = row.media;
            const series =
              media.kind === "episode" ? (media.parent?.parent ?? null) : null;
            return {
              id: row.id,
              mediaId: media.id,
              rootMediaId: series?.id ?? media.id,
              title: media.title,
              seriesTitle: series?.title ?? null,
              seasonNumber: media.seasonNumber,
              episodeNumber: media.episodeNumber,
              kind: row.kind,
              region: row.region === "US" ? "US" : null,
              date: row.date,
              precision: row.precision,
              availability: external.has(media.id)
                ? "available"
                : media.availability,
              observedAt: row.observedAt,
            };
          })
          .filter(
            (row) =>
              query.status === "all" ||
              (row.availability === "available") ===
                (query.status === "available"),
          ),
        nextCursor:
          last !== undefined && rows.length > query.limit
            ? JSON.stringify({ date: last.date, id: last.id })
            : null,
      });
    });
  }
}
