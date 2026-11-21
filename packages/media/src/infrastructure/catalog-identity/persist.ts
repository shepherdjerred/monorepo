import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import type { CatalogIdentity } from "#shared/acquisition/catalog.ts";
import { lockCanonicalMedia } from "#infrastructure/editions/locks.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { mergeCatalogIdentity } from "./catalog.ts";
import {
  MovieReleaseDateSchema,
  SeriesStatusSchema,
  type MovieReleaseDate,
} from "#shared/household/calendar.ts";

export type CatalogArtwork = {
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
};

/** TMDB sends an empty synopsis for a title that has none; that is absence. */
export function catalogArtwork(details: {
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
}): CatalogArtwork {
  return {
    posterPath: details.poster_path,
    backdropPath: details.backdrop_path,
    overview: details.overview === "" ? null : details.overview,
  };
}

type CatalogMediaInput = {
  kind: "movie" | "series";
  tmdbId: number;
  title: string;
  year: number | null;
  originalLanguage: string;
  runtimeMinutes: number | null;
  identity: CatalogIdentity;
  artwork: CatalogArtwork;
  seriesStatus?: z.infer<typeof SeriesStatusSchema>;
  releaseDates?: MovieReleaseDate[];
  observedAt?: Date;
};

/**
 * Artwork is presentation and never command state. It is written after the
 * versioned catalog fields, in the same transaction and under the same
 * canonical lock, and deliberately leaves `version` alone: that number is the
 * optimistic-concurrency token of every media command, and a changed poster
 * must not invalidate one.
 */
export async function persistCatalogMedia(
  tx: Prisma.TransactionClient,
  input: CatalogMediaInput,
) {
  const observedAt = input.observedAt ?? new Date();
  const item = await persistVersionedCatalog(tx, input, observedAt);
  return await tx.mediaItem.update({
    where: { id: item.id },
    data: {
      posterPath: input.artwork.posterPath,
      backdropPath: input.artwork.backdropPath,
      overview: input.artwork.overview,
      artworkObservedAt: observedAt,
    },
  });
}

async function persistVersionedCatalog(
  tx: Prisma.TransactionClient,
  input: CatalogMediaInput,
  observedAt: Date,
) {
  const existing = await tx.mediaItem.findUnique({
    where: { kind_tmdbId: { kind: input.kind, tmdbId: input.tmdbId } },
  });
  if (existing !== null) await lockCanonicalMedia(tx, [existing.id]);
  const current =
    existing === null
      ? null
      : await tx.mediaItem.findUniqueOrThrow({ where: { id: existing.id } });
  const fields = {
    title: input.title,
    year: input.year,
    originalLanguage: input.originalLanguage,
    runtimeMinutes: input.runtimeMinutes,
    externalIds: mergeCatalogIdentity(
      current?.externalIds ?? {},
      input.identity,
      input,
    ),
    ...(input.seriesStatus === undefined
      ? {}
      : { seriesStatus: SeriesStatusSchema.parse(input.seriesStatus) }),
  };
  const item =
    current ??
    (await tx.mediaItem.create({
      data: {
        kind: input.kind,
        tmdbId: input.tmdbId,
        ...fields,
        ...(input.kind === "series" ? { catalogState: "pending" } : {}),
      },
    }));
  if (input.seriesStatus !== undefined)
    await tx.mediaItem.update({
      where: { id: item.id },
      data: { seriesStatusObservedAt: observedAt, catalogCompletedAt: null },
    });
  if (input.releaseDates !== undefined) {
    const releases = z
      .array(MovieReleaseDateSchema)
      .max(500)
      .parse(input.releaseDates);
    await tx.mediaReleaseDate.deleteMany({ where: { mediaId: item.id } });
    await tx.mediaReleaseDate.createMany({
      data: releases.map((release) => ({
        ...release,
        id: snapshotHash({ mediaId: item.id, ...release }),
        mediaId: item.id,
        observedAt,
      })),
    });
  }
  if (current === null) return item;
  const previous = {
    title: current.title,
    year: current.year,
    originalLanguage: current.originalLanguage,
    runtimeMinutes: current.runtimeMinutes,
    externalIds: current.externalIds,
    ...(input.seriesStatus === undefined
      ? {}
      : { seriesStatus: current.seriesStatus }),
  };
  if (snapshotHash(z.json().parse(previous)) === snapshotHash(fields))
    return current;
  return await tx.mediaItem.update({
    where: { id: current.id },
    data: { ...fields, version: { increment: 1 } },
  });
}
