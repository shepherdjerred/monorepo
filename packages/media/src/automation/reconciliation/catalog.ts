import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import type { Prisma, MediaItem } from "#generated/prisma/client.ts";
import { loadSeriesCatalogIdentity } from "#infrastructure/catalog-identity/catalog.ts";
import { persistCatalogMedia } from "#infrastructure/catalog-identity/persist.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { snapshotHash } from "#migration/profile-import.ts";

const SeasonSchema = z.object({
  id: z.number().int(),
  season_number: z.number().int().nonnegative(),
  name: z.string(),
  episode_count: z.number().int().nonnegative(),
});
const EpisodeSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  season_number: z.number().int(),
  episode_number: z.number().int(),
  air_date: z.string().nullable(),
  runtime: z.number().int().positive().nullable().optional(),
});
const CheckpointSchema = z.object({
  seasons: z.array(SeasonSchema),
  season: z.number().int().nonnegative().default(0),
  offset: z.number().int().nonnegative().default(0),
  episodes: z.array(EpisodeSchema).nullable().default(null),
  completed: z.boolean().default(false),
});

/** Network reads occur outside transactions; each write page contains <=25 episodes. */
export function createCatalogActivities(
  context: MediaAutomationContext,
): Pick<MediaNetworkActivities, "refreshMediaCatalog"> {
  return {
    async refreshMediaCatalog(input) {
      let media = await context.db.mediaItem.findUniqueOrThrow({
        where: { id: input.mediaId },
      });
      if (media.kind !== "series" || media.tmdbId === null)
        throw new Error("Catalog refresh requires a canonical series");
      const operation = await context.db.operation.findUniqueOrThrow({
        where: { id: input.operationId },
      });
      const result = z
        .object({ catalog: CheckpointSchema.optional() })
        .parse(operation.result ?? {});
      let checkpoint = result.catalog;
      if (checkpoint === undefined) {
        const { details: series, identity } = await loadSeriesCatalogIdentity(
          context.tmdb,
          media.tmdbId,
        );
        media = await serializable(context.db, (tx) =>
          persistCatalogMedia(tx, {
            kind: "series",
            tmdbId: series.id,
            title: series.name,
            year:
              series.first_air_date === ""
                ? null
                : z
                    .int()
                    .min(1800)
                    .max(3000)
                    .parse(Number(series.first_air_date.slice(0, 4))),
            originalLanguage: series.original_language,
            runtimeMinutes: null,
            identity,
          }),
        );
        checkpoint = CheckpointSchema.parse({ seasons: series.seasons });
      }
      if (checkpoint.completed) return { processed: 0, nextCursor: null };
      const season = checkpoint.seasons[checkpoint.season];
      if (season === undefined) {
        await completeCatalog(context, input, checkpoint);
        return { processed: 0, nextCursor: null };
      }
      const episodes =
        checkpoint.episodes ??
        (await context.tmdb.season(
          z.int().positive().parse(media.tmdbId),
          season.season_number,
        ));
      const page = episodes.slice(checkpoint.offset, checkpoint.offset + 25);
      const finishedSeason = checkpoint.offset + page.length >= episodes.length;
      const next = {
        ...checkpoint,
        season: checkpoint.season + (finishedSeason ? 1 : 0),
        offset: finishedSeason ? 0 : checkpoint.offset + page.length,
        episodes: finishedSeason ? null : episodes,
      };
      await serializable(context.db, async (tx) => {
        await lockAcquisitionMedia(tx, [media.id]);
        const current = await tx.operation.findUniqueOrThrow({
          where: { id: operation.id },
        });
        const stored = z
          .object({ catalog: CheckpointSchema.optional() })
          .parse(current.result ?? {}).catalog;
        // A duplicate Activity completion must never rewind a committed page.
        if (
          stored !== undefined &&
          (stored.season > checkpoint.season ||
            (stored.season === checkpoint.season &&
              stored.offset > checkpoint.offset))
        )
          return;
        const previousSeason = await lockCatalogPage(
          tx,
          media.id,
          season,
          page,
        );
        const parent = await tx.mediaItem.upsert({
          where: { kind_tmdbId: { kind: "season", tmdbId: season.id } },
          create: {
            kind: "season",
            tmdbId: season.id,
            title: `${media.title}: ${season.name}`,
            parentId: media.id,
            seasonNumber: season.season_number,
            originalLanguage: media.originalLanguage,
          },
          update: {
            title: `${media.title}: ${season.name}`,
            parentId: media.id,
            seasonNumber: season.season_number,
            originalLanguage: media.originalLanguage,
          },
        });
        let changed =
          previousSeason?.title !== parent.title ||
          previousSeason.originalLanguage !== parent.originalLanguage;
        for (const episode of page)
          changed =
            (await persistEpisode(tx, episode, {
              series: media,
              season: parent,
            })) || changed;
        if (changed)
          await tx.mediaItem.update({
            where: { id: media.id },
            data: { version: { increment: 1 } },
          });
        await tx.$executeRaw`UPDATE "Operation" SET result = COALESCE(result, '{}'::jsonb) || ${JSON.stringify({ catalog: next })}::jsonb WHERE id = ${operation.id}`;
      });
      return {
        processed: page.length,
        nextCursor: `${String(next.season)}:${String(next.offset)}`,
      };
    },
  };
}

async function lockCatalogPage(
  tx: Prisma.TransactionClient,
  seriesId: string,
  season: z.infer<typeof SeasonSchema>,
  page: z.infer<typeof EpisodeSchema>[],
) {
  const previousSeason = await tx.mediaItem.findUnique({
    where: { kind_tmdbId: { kind: "season", tmdbId: season.id } },
  });
  if (
    previousSeason !== null &&
    (previousSeason.parentId !== seriesId ||
      previousSeason.seasonNumber !== season.season_number)
  )
    throw new Error("Catalog season identity conflicts with existing mapping");
  const episodes = await tx.mediaItem.findMany({
    where: { kind: "episode", tmdbId: { in: page.map((item) => item.id) } },
  });
  if (episodes.some((item) => item.parentId !== previousSeason?.id))
    throw new Error(
      "Catalog episode identity conflicts with existing numbering",
    );
  // Root is already held. Acquire the complete existing set once before
  // upserting any row; upstream episode order is not the database lock order.
  await lockAcquisitionMedia(tx, [
    ...(previousSeason === null ? [] : [previousSeason.id]),
    ...episodes.map((item) => item.id),
  ]);
  return previousSeason;
}

async function persistEpisode(
  tx: Prisma.TransactionClient,
  episode: z.infer<typeof EpisodeSchema>,
  parents: { series: MediaItem; season: MediaItem },
) {
  const existing = await tx.mediaItem.findUnique({
    where: { kind_tmdbId: { kind: "episode", tmdbId: episode.id } },
  });
  const externalIds = z
    .record(z.string(), z.json())
    .parse(existing?.externalIds ?? {});
  assertEpisodeReferences(externalIds, episode.id, parents.series.tmdbId);
  if (
    episode.season_number !== parents.season.seasonNumber ||
    (existing !== null &&
      (existing.parentId !== parents.season.id ||
        existing.seasonNumber !== episode.season_number ||
        existing.episodeNumber !== episode.episode_number))
  )
    throw new Error(
      "Catalog episode identity conflicts with existing numbering",
    );
  const airDate =
    episode.air_date === null || episode.air_date === ""
      ? null
      : new Date(episode.air_date);
  const fields = {
    title: episode.name,
    parentId: parents.season.id,
    seasonNumber: episode.season_number,
    episodeNumber: episode.episode_number,
    year: airDate?.getUTCFullYear() ?? null,
    airDate,
    runtimeMinutes: episode.runtime ?? null,
    originalLanguage: parents.series.originalLanguage,
    externalIds: {
      ...externalIds,
      tmdb: episode.id,
      seriesTmdb: parents.series.tmdbId,
    },
  };
  const changed =
    existing === null ||
    snapshotHash(
      z.json().parse({
        title: existing.title,
        parentId: existing.parentId,
        seasonNumber: existing.seasonNumber,
        episodeNumber: existing.episodeNumber,
        year: existing.year,
        airDate: existing.airDate?.toISOString() ?? null,
        runtimeMinutes: existing.runtimeMinutes,
        originalLanguage: existing.originalLanguage,
        externalIds: existing.externalIds,
      }),
    ) !==
      snapshotHash({
        ...fields,
        airDate: fields.airDate?.toISOString() ?? null,
      });
  if (!changed) return false;
  await tx.mediaItem.upsert({
    where: { kind_tmdbId: { kind: "episode", tmdbId: episode.id } },
    create: { kind: "episode", tmdbId: episode.id, ...fields },
    update: { ...fields, version: { increment: 1 } },
  });
  return true;
}

function assertEpisodeReferences(
  externalIds: Record<string, z.infer<ReturnType<typeof z.json>>>,
  episodeId: number,
  seriesId: number | null,
) {
  for (const [key, expected] of Object.entries({
    tmdb: episodeId,
    seriesTmdb: seriesId,
  })) {
    const previous = externalIds[key];
    if (
      previous !== undefined &&
      ((typeof previous !== "string" && typeof previous !== "number") ||
        String(previous) !== String(expected))
    )
      throw new Error(
        "Catalog canonical identity conflicts with existing mapping",
      );
  }
}

async function completeCatalog(
  context: MediaAutomationContext,
  input: { operationId: string; mediaId: string },
  checkpoint: z.infer<typeof CheckpointSchema>,
): Promise<void> {
  await serializable(context.db, async (tx) => {
    await lockAcquisitionMedia(tx, [input.mediaId]);
    await tx.mediaItem.updateMany({
      where: { id: input.mediaId, catalogState: { not: "ready" } },
      data: { catalogState: "ready", version: { increment: 1 } },
    });
    await tx.$executeRaw`UPDATE "Operation" SET result = COALESCE(result, '{}'::jsonb) || ${JSON.stringify({ catalog: { ...checkpoint, completed: true } })}::jsonb WHERE id = ${input.operationId}`;
    // Root requests are bounded separately by the due sweep; catalog completion
    // only records a versioned trigger, never loops over a large user population.
    await queueOperation(tx, {
      key: `catalog-coverage:${input.operationId}`,
      kind: "expand_catalog_requests",
      targetId: input.mediaId,
      payload: { mediaId: input.mediaId, cursor: null },
    });
  });
}
