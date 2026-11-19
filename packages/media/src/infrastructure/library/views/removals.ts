import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { Prisma as PrismaRuntime } from "#generated/prisma/client.ts";
import {
  RemovalHistoryPageSchema,
  RemovalHistoryQuerySchema,
  RemovalHistoryCursorSchema,
  type RemovalHistoryQuery,
} from "#shared/household/calendar.ts";
import type { Database } from "#infrastructure/database.ts";
import { repeatableRead } from "#infrastructure/locks.ts";
import {
  visibilityAncestry,
  visibilityReader,
} from "#infrastructure/visibility/access.ts";
import type { CalendarReadSettings } from "#infrastructure/library/views/calendar.ts";

const PublicReasonSchema = z.object({
  ownerOverride: z.unknown().optional(),
  removalReason: z.literal("temporary_interest_released").optional(),
});
const DecisionReferenceSchema = z.object({ decisionId: z.string() });

/** Read the existing committed removal evidence. Missing external files never become removals. */
export class PrismaRemovalHistoryApplication {
  constructor(
    private readonly db: Database,
    private readonly settings: CalendarReadSettings,
  ) {}

  list(actor: MediaActor, raw: RemovalHistoryQuery) {
    const query = RemovalHistoryQuerySchema.parse(raw);
    const cursor =
      query.cursor === null
        ? null
        : RemovalHistoryCursorSchema.parse(JSON.parse(query.cursor));
    return repeatableRead(this.db, async (tx) => {
      const reader = await visibilityReader(tx, actor, this.settings);
      const historical: Prisma.MediaItemWhereInput = {
        requests: { some: { userId: actor.id } },
      };
      const rows = await tx.retentionDecision.findMany({
        where: {
          ...(cursor === null
            ? {}
            : {
                OR: [
                  { createdAt: { lt: new Date(cursor.createdAt) } },
                  {
                    createdAt: new Date(cursor.createdAt),
                    id: { lt: cursor.id },
                  },
                ],
              }),
          quarantinedAt: { not: null },
          manifest: { not: PrismaRuntime.DbNull },
          state: { in: ["quarantined", "purged", "restored", "cancelled"] },
          ...(reader.owner
            ? {}
            : {
                media: {
                  OR: [
                    historical,
                    { parent: historical },
                    { parent: { parent: historical } },
                  ],
                },
              }),
        },
        include: { media: { include: visibilityAncestry } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const claims = reader.owner
        ? []
        : await tx.mediaRequest.findMany({
            where: {
              userId: actor.id,
              mediaId: {
                in: page.flatMap((row) =>
                  [
                    row.media.id,
                    row.media.parent?.id,
                    row.media.parent?.parent?.id,
                  ].flatMap((id) => (id === undefined ? [] : [id])),
                ),
              },
            },
            select: { mediaId: true, edition: true },
          });
      const events = await tx.applicationEvent.findMany({
        where: {
          kind: "files_purged",
          OR: page.map((row) => ({
            payload: { path: ["decisionId"], equals: row.id },
          })),
        },
        select: { payload: true, createdAt: true },
        take: query.limit,
      });
      return RemovalHistoryPageSchema.parse({
        items: page
          .filter(
            (row) =>
              reader.visible(row.media) &&
              (reader.owner ||
                claims.some(
                  (claim) =>
                    claim.edition === row.edition &&
                    [
                      row.media.id,
                      row.media.parent?.id,
                      row.media.parent?.parent?.id,
                    ].includes(claim.mediaId),
                )),
          )
          .map((row) => {
            const evidence = PublicReasonSchema.parse(row.evidence);
            const ownerRemoved = evidence.ownerOverride !== undefined;
            const purged = events.find(
              (event) =>
                DecisionReferenceSchema.parse(event.payload).decisionId ===
                row.id,
            );
            return {
              id: row.id,
              mediaId: row.mediaId,
              title: row.media.title,
              kind: row.media.kind,
              edition: row.edition,
              seriesTitle:
                row.media.kind === "episode"
                  ? (row.media.parent?.parent?.title ?? null)
                  : null,
              seasonNumber: row.media.seasonNumber,
              episodeNumber: row.media.episodeNumber,
              reason: ownerRemoved
                ? "owner_removed"
                : (evidence.removalReason ?? "watched_by_requesters"),
              actor: ownerRemoved ? "owner" : "automatic",
              requesterContext: reader.owner ? "household" : "your_request",
              state: row.state,
              quarantinedAt: row.quarantinedAt,
              purgedAt: purged?.createdAt ?? null,
              restoreDeadline: row.purgeAfter,
              restoreState:
                row.state === "restored"
                  ? "restored"
                  : row.state === "purged"
                    ? "reacquire"
                    : row.purgeAfter !== null &&
                        row.purgeAfter.getTime() > Date.now()
                      ? "recoverable"
                      : "unavailable",
            };
          }),
        nextCursor:
          last !== undefined && rows.length > query.limit
            ? JSON.stringify({
                createdAt: last.createdAt.toISOString(),
                id: last.id,
              })
            : null,
      });
    });
  }
}
