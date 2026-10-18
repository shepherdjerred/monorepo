import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { NumberingProvenanceSchema } from "#shared/acquisition/coordinates.ts";
import { snapshotHash } from "#migration/profile-import.ts";

export async function numberingCatalog(
  tx: Pick<Prisma.TransactionClient, "mediaItem">,
  seriesId: string,
) {
  const series = await tx.mediaItem.findUniqueOrThrow({
    where: { id: seriesId },
  });
  if (
    series.kind !== "series" ||
    series.tmdbId === null ||
    series.catalogState !== "ready"
  )
    throw new MediaError(
      "catalog_incomplete",
      "Complete the canonical series catalog before numbering",
      409,
    );
  const episodes = await tx.mediaItem.findMany({
    where: {
      kind: "episode",
      OR: [
        { parentId: series.id },
        { parent: { kind: "season", parentId: series.id } },
      ],
    },
    orderBy: { id: "asc" },
    take: 5001,
  });
  if (episodes.length === 0 || episodes.length > 5000)
    throw new MediaError(
      "catalog_bound",
      "Series numbering requires a complete catalog within 5,000 episodes",
      409,
    );
  const rows = episodes.map((episode) => {
    const ids = z.record(z.string(), z.json()).parse(episode.externalIds);
    const absoluteNumber =
      ids["absoluteNumber"] === undefined
        ? null
        : z.int().positive().parse(ids["absoluteNumber"]);
    const provenance =
      ids["numberingProvenance"] === undefined
        ? absoluteNumber === null
          ? NumberingProvenanceSchema.parse({ kind: "canonical" })
          : NumberingProvenanceSchema.parse({
              kind: "legacy_owner",
              version: episode.version,
              evidence: z.string().parse(ids["numberingEvidence"]),
            })
        : NumberingProvenanceSchema.parse(ids["numberingProvenance"]);
    return { ...episode, absoluteNumber, provenance };
  });
  const catalogDigest = snapshotHash({
    seriesId: series.id,
    tmdbId: series.tmdbId,
    episodes: rows.map((row) => ({
      id: row.id,
      tmdbId: row.tmdbId,
      season: row.seasonNumber,
      episode: row.episodeNumber,
    })),
  });
  const numberingDigest = snapshotHash({
    seriesVersion: series.version,
    episodes: rows.map((row) => ({
      id: row.id,
      version: row.version,
      absoluteNumber: row.absoluteNumber,
      provenance: row.provenance,
    })),
  });
  return { series, episodes: rows, catalogDigest, numberingDigest };
}
export type NumberingCatalog = Awaited<ReturnType<typeof numberingCatalog>>;
