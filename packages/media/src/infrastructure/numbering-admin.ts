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
import { lockAcquisitionMedia } from "./acquisition-identity/locks.ts";
import { lockEffectiveRequests } from "./request-claims.ts";
import {
  assertNumberingOwner,
  writeNumberingMapping,
} from "./catalog-identity/numbering-write.ts";
import { CatalogNumberingAdministration } from "./catalog-identity/numbering-service.ts";
import type { TmdbClient } from "#integrations/tmdb.ts";
import type {
  PreviewNumberingGroup,
  CommitNumberingGroup,
} from "#shared/acquisition/numbering.ts";

export class PrismaNumberingAdministration extends MediaCommandBase {
  constructor(
    private readonly db: Database,
    private readonly tmdb?: TmdbClient,
  ) {
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
        await lockAcquisitionMedia(tx, [seriesId]);
        const siblings = await tx.mediaItem.findMany({
          where: {
            kind: "episode",
            OR: [{ parentId: seriesId }, { parent: { parentId: seriesId } }],
          },
        });
        await lockAcquisitionMedia(
          tx,
          siblings.map((item) => item.id),
        );
        await lockEffectiveRequests(
          tx,
          siblings.map((item) => item.id),
        );
        await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
        await assertNumberingOwner(tx, actor.id);
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
        await writeNumberingMapping(tx, {
          actorId: actor.id,
          episodeId,
          absoluteNumber: input.absoluteNumber,
          evidence: input.evidence,
        });
        await tx.mediaItem.update({
          where: { id: seriesId },
          data: { version: { increment: 1 } },
        });
        return { status: "completed", version: current.version + 1 };
      },
    );
  }

  groups(actor: MediaActor, seriesId: string) {
    return this.groupService().groups(actor, seriesId);
  }
  group(actor: MediaActor, seriesId: string, groupId: string) {
    return this.groupService().group(actor, seriesId, groupId);
  }
  previewGroup(
    actor: MediaActor,
    seriesId: string,
    input: PreviewNumberingGroup,
  ) {
    return this.groupService().previewGroup(actor, seriesId, input);
  }
  commitGroup(
    actor: MediaActor,
    key: string,
    seriesId: string,
    input: CommitNumberingGroup,
  ) {
    return this.groupService().commitGroup(actor, key, seriesId, input);
  }
  private groupService() {
    if (this.tmdb === undefined)
      throw new MediaError(
        "catalog_unconfigured",
        "TMDB numbering is unavailable",
        503,
      );
    return new CatalogNumberingAdministration(this.db, this.tmdb);
  }
}
