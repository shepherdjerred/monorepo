import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import {
  EpisodeNumberingSchema,
  NumberingEpisodeListSchema,
  NumberingSeriesListSchema,
  type SaveEpisodeNumbering,
} from "#shared/numbering.ts";
import type { Database } from "./database.ts";
import { MediaCommandBase } from "./command-base.ts";
import { lockMedia } from "./locks.ts";

export class PrismaNumberingAdministration extends MediaCommandBase {
  constructor(private readonly db: Database) {
    super(db, { keepDays: 30 });
  }
  async series(actor: MediaActor, query: string) {
    requireOwner(actor);
    return NumberingSeriesListSchema.parse(
      await this.db.mediaItem.findMany({
        where: {
          kind: "series",
          title: { contains: query, mode: "insensitive" },
        },
        orderBy: { title: "asc" },
        take: 100,
        select: { id: true, title: true, year: true },
      }),
    );
  }
  async episodes(actor: MediaActor, seriesId: string, offset = 0) {
    requireOwner(actor);
    const items = await this.db.mediaItem.findMany({
      where: {
        kind: "episode",
        OR: [
          { parentId: seriesId },
          { parent: { parentId: seriesId, kind: "season" } },
        ],
      },
      orderBy: [
        { seasonNumber: "asc" },
        { episodeNumber: "asc" },
        { id: "asc" },
      ],
      skip: z.number().int().nonnegative().parse(offset),
      take: 200,
    });
    return NumberingEpisodeListSchema.parse(
      items.map((item) => {
        const numbering = EpisodeNumberingSchema.parse(item.externalIds);
        return {
          ...item,
          absoluteNumber: numbering.absoluteNumber ?? null,
          evidence: numbering.numberingEvidence ?? null,
        };
      }),
    );
  }
  async save(
    actor: MediaActor,
    key: string,
    episodeId: string,
    input: SaveEpisodeNumbering,
  ) {
    requireOwner(actor);
    return await this.command(
      actor,
      key,
      { kind: "map_episode_numbering", input: { episodeId, ...input } },
      async (tx) => {
        const episode = await tx.mediaItem.findUniqueOrThrow({
          where: { id: episodeId },
          include: { parent: true },
        });
        const seriesId =
          episode.parent?.kind === "series"
            ? episode.parent.id
            : episode.parent?.kind === "season"
              ? episode.parent.parentId
              : null;
        if (seriesId === null || episode.kind !== "episode")
          throw new MediaError(
            "episode_required",
            "Select an episode in a canonical series",
            422,
          );
        await lockMedia(tx, [seriesId, episodeId]);
        const siblings = await tx.mediaItem.findMany({
          where: {
            kind: "episode",
            OR: [{ parentId: seriesId }, { parent: { parentId: seriesId } }],
          },
        });
        if (
          input.absoluteNumber !== null &&
          siblings.some(
            (item) =>
              item.id !== episodeId &&
              EpisodeNumberingSchema.parse(item.externalIds).absoluteNumber ===
                input.absoluteNumber,
          )
        )
          throw new MediaError(
            "numbering_conflict",
            "That absolute number already belongs to another episode",
            409,
          );
        const current = siblings.find((item) => item.id === episodeId);
        if (current?.version !== input.expectedVersion)
          throw new MediaError(
            "version_conflict",
            "Episode changed; refresh before mapping",
            409,
          );
        const ids = z.record(z.string(), z.json()).parse(current.externalIds);
        delete ids["absoluteNumber"];
        if (input.absoluteNumber !== null)
          ids["absoluteNumber"] = input.absoluteNumber;
        ids["numberingEvidence"] = input.evidence;
        await tx.mediaItem.update({
          where: { id: episodeId },
          data: { externalIds: ids, version: { increment: 1 } },
        });
        const intent = await tx.mediaIntent.findUnique({
          where: { mediaId: episodeId },
        });
        if (intent !== null) {
          const updated = await tx.mediaIntent.update({
            where: { mediaId: episodeId },
            data: { generation: { increment: 1 }, version: { increment: 1 } },
          });
          await this.enqueue(tx, actor, {
            kind: "reconcile_media",
            mediaId: episodeId,
            generation: updated.generation,
          });
        }
        await tx.applicationEvent.create({
          data: {
            actorId: actor.id,
            mediaId: episodeId,
            kind: "episode_numbering_mapped",
            payload: {
              absoluteNumber: input.absoluteNumber,
              evidence: input.evidence,
            },
          },
        });
        return { status: "completed", version: current.version + 1 };
      },
    );
  }
}
