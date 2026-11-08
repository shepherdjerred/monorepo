import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { MAX_MIGRATION_RECORDS } from "#shared/migration.ts";

const ExternalIds = z.object({
  tmdb: z.number().int().positive().nullish(),
  tvdb: z.number().int().positive().nullish(),
  imdb: z
    .string()
    .regex(/^tt\d+$/u)
    .nullish(),
});
export function catalogIdentity(item: {
  tmdbId: number | null;
  externalIds: unknown;
}) {
  const ids = ExternalIds.parse(item.externalIds);
  if (item.tmdbId !== null && ids.tmdb != null && item.tmdbId !== ids.tmdb)
    throw new MediaError(
      "catalog_identity_conflict",
      "Catalog TMDB identities disagree",
      409,
    );
  const tmdb = item.tmdbId ?? ids.tmdb;
  return {
    ...(tmdb == null ? {} : { tmdb }),
    ...(ids.tvdb == null ? {} : { tvdb: ids.tvdb }),
    ...(ids.imdb == null ? {} : { imdb: ids.imdb }),
  };
}
export async function migrationTargets(tx: Prisma.TransactionClient) {
  const items = await tx.mediaItem.findMany({
    take: MAX_MIGRATION_RECORDS + 1,
    include: {
      parent: { include: { parent: true } },
      assets: { where: { current: true }, include: { asset: true } },
    },
  });
  if (items.length > MAX_MIGRATION_RECORDS)
    throw new MediaError(
      "migration_limit",
      "Target library exceeds review capture limit",
      422,
    );
  return items
    .filter((item) => {
      if (item.kind !== "episode") return true;
      const series =
        item.parent?.kind === "series" ? item.parent : item.parent?.parent;
      return series?.kind === "series" && series.catalogState === "ready";
    })
    .map((item) => {
      const series =
        item.parent?.kind === "series" ? item.parent : item.parent?.parent;
      return {
        mediaId: item.id,
        title: item.title,
        kind: item.kind,
        externalIds: catalogIdentity(item),
        ...(series?.kind === "series"
          ? { seriesExternalIds: catalogIdentity(series) }
          : {}),
        season: item.seasonNumber,
        episode: item.episodeNumber,
        checksum:
          item.assets.length === 1
            ? (item.assets[0]?.asset.checksum ?? null)
            : null,
      };
    });
}
