import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import type { SeriesSeasonSetV1 } from "#shared/acquisition/series-pack-v1.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  buildCanonicalIdentity,
  canonicalSemantics,
  identityHash,
} from "#infrastructure/acquisition-identity/snapshot.ts";

/** Operational catalog reads have a whole-closure bound; the immutable profile parent consumes the original allowance. */
export async function seriesPackCatalogV1(
  tx: Prisma.TransactionClient,
  input: { primaryMediaId: string; range: SeriesSeasonSetV1 },
  budget: PublicationAuthorityReadBudget,
) {
  const primary = await tx.mediaItem.findUniqueOrThrow({
    where: { id: input.primaryMediaId },
    include: { parent: { include: { parent: true } } },
  });
  const root =
    primary.parent?.kind === "series" ? primary.parent : primary.parent?.parent;
  if (
    primary.kind !== "episode" ||
    root?.kind !== "series" ||
    root.catalogState !== "ready"
  )
    throw seriesPackChanged(
      "A multi-season pack requires one complete canonical series",
    );
  const episodes = await tx.mediaItem.findMany({
    where: {
      kind: "episode",
      seasonNumber: { in: input.range.seasons },
      OR: [
        { parentId: root.id },
        { parent: { kind: "season", parentId: root.id } },
      ],
    },
    orderBy: { id: "asc" },
    take: 101,
  });
  if (episodes.length > 100)
    throw seriesPackChanged(
      "The whole multi-season pack exceeds 100 canonical leaves",
    );
  if (
    episodes.length === 0 ||
    !episodes.some((episode) => episode.id === primary.id) ||
    episodes.some((episode) => episode.catalogState !== "ready") ||
    input.range.seasons.some(
      (season) => !episodes.some((episode) => episode.seasonNumber === season),
    )
  )
    throw seriesPackChanged(
      "Every named season must have its complete ready catalog coverage",
    );
  if (
    episodes.some(
      (episode) =>
        episode.airDate !== null && episode.airDate.getTime() > Date.now(),
    )
  )
    throw new MediaError(
      "not_yet_aired",
      "A multi-season pack includes an unaired canonical episode",
      409,
    );
  const canonical = await buildCanonicalIdentity(
    tx,
    episodes.map((episode) => episode.id),
  );
  if (canonical.kind !== "series")
    throw seriesPackChanged("Pack canonical identity changed its kind");
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: primary.id, edition: "default" } },
    include: { profile: true },
  });
  if (target.editionRootId !== root.id || target.profile === null)
    throw seriesPackChanged("Pack primary scope or profile changed");
  const profile = await tx.qualityProfileVersion.findUniqueOrThrow({
    where: {
      profileId_version: {
        profileId: target.profile.id,
        version: target.profile.version,
      },
    },
  });
  budget.consume(1);
  const metadata = episodes.map((episode) => ({
    mediaId: episode.id,
    runtimeMinutes: episode.runtimeMinutes,
    originalLanguage: episode.originalLanguage,
    airDate: episode.airDate?.toISOString() ?? null,
  }));
  let runtimeMinutes: number | null = 0;
  for (const episode of episodes) {
    if (episode.runtimeMinutes === null) runtimeMinutes = null;
    else if (runtimeMinutes !== null) runtimeMinutes += episode.runtimeMinutes;
  }
  return {
    root,
    primary,
    target,
    canonical,
    canonicalHash: identityHash({
      canonical: canonicalSemantics(canonical),
      metadata,
      originalLanguage: root.originalLanguage,
    }),
    profile: {
      id: profile.profileId,
      version: profile.version,
      hash: identityHash(profile.rules),
    },
    rules: QualityRulesSchema.parse(profile.rules),
    profileRules: profile.rules,
    runtimeMinutes,
    originalLanguage: root.originalLanguage,
  };
}

export function seriesPackChanged(message: string) {
  return new MediaError("series_pack_interpretation_changed", message, 409);
}
