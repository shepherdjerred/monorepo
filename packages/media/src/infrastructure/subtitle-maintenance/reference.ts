import path from "node:path";
import { z } from "zod";
import type { MediaItem } from "#generated/prisma/client.ts";
import { canonicalReferences } from "#infrastructure/acquisition-identity/references.ts";
import { SubtitleScoreReferenceV1Schema } from "#shared/subtitle-maintenance/score.ts";

type Item = Pick<
  MediaItem,
  | "kind"
  | "title"
  | "year"
  | "seasonNumber"
  | "episodeNumber"
  | "tmdbId"
  | "externalIds"
>;
type CoveredItem = Item & { parent?: (Item & { parent?: Item | null }) | null };

/** The actual canonical series supplies title/year/IDs; episode titles never
 * stand in for series identity. Unknown measurement stays unknown. */
export function subtitleScoreReferenceV1(asset: {
  sourcePath: string | null;
  edition: string;
  properties: unknown;
  coverage: readonly { media: CoveredItem }[];
}) {
  const media = asset.coverage[0]?.media;
  if (
    media === undefined ||
    asset.sourcePath === null ||
    asset.coverage.length !== 1
  )
    return null;
  const root =
    media.kind === "movie"
      ? media
      : media.parent?.kind === "series"
        ? media.parent
        : media.parent?.parent;
  if (
    root === undefined ||
    root === null ||
    !["movie", "series"].includes(root.kind)
  )
    return null;
  const ids = canonicalReferences(root).references;
  const properties = z
    .object({
      quality: z.string().optional(),
      codec: z.string().optional(),
      audioCodec: z.string().optional(),
    })
    .parse(asset.properties);
  return SubtitleScoreReferenceV1Schema.parse({
    schemaVersion: 1,
    kind: media.kind === "movie" ? "movie" : "episode",
    title: root.title,
    year: root.year,
    season: media.seasonNumber,
    episode: media.episodeNumber,
    sourceFilename: path.basename(asset.sourcePath),
    quality: properties.quality ?? null,
    videoCodec: properties.codec ?? null,
    audioCodec: properties.audioCodec ?? null,
    imdbId: ids.find((id) => id.namespace === "imdb")?.value ?? null,
    tmdbId: root.tmdbId,
    edition: asset.edition,
  });
}
