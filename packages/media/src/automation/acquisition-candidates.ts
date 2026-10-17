import { z } from "zod";
import type { MediaAutomationContext } from "./context.ts";
import {
  QualityRulesSchema,
  PublicReleaseAttributesSchema,
} from "#shared/api.ts";
import type { QualityProfile, ReleaseAttributes } from "#shared/contract.ts";
import { matchRelease } from "#domain/release-parser.ts";
import { chooseUpgrade } from "#domain/quality.ts";
import { ProviderIdSchema } from "./providers.ts";
import { IntegrationError } from "#integrations/http.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";

export async function loadProfile(
  db: MediaAutomationContext["db"],
  mediaId: string,
): Promise<QualityProfile | null> {
  const intent = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId },
    include: { profile: true },
  });
  if (intent.profile === null) return null;
  const snapshot = await db.qualityProfileVersion.findUniqueOrThrow({
    where: {
      profileId_version: {
        profileId: intent.profile.id,
        version: intent.profile.version,
      },
    },
  });
  return {
    id: snapshot.profileId,
    version: snapshot.version,
    ...QualityRulesSchema.parse(snapshot.rules),
  };
}

export async function currentRelease(
  context: MediaAutomationContext,
  mediaId: string,
): Promise<ReleaseAttributes | null> {
  const coverage = await context.db.assetCoverage.findFirst({
    where: { mediaId, current: true },
    include: { asset: true },
  });
  if (coverage === null) return null;
  const properties = z
    .object({ releaseId: z.string().optional() })
    .parse(coverage.asset.properties);
  if (properties.releaseId === undefined)
    throw new Error("Current asset lacks release provenance");
  const release = await context.db.releaseCandidate.findUniqueOrThrow({
    where: { id: properties.releaseId },
  });
  return {
    id: release.id,
    providerId: release.providerId,
    title: release.title,
    ...PublicReleaseAttributesSchema.parse(release.attributes),
  };
}

async function searchTarget(context: MediaAutomationContext, mediaId: string) {
  const media = await context.db.mediaItem.findUniqueOrThrow({
    where: { id: mediaId },
    include: { parent: { include: { parent: true } } },
  });
  const series =
    media.kind === "episode"
      ? media.parent?.kind === "series"
        ? media.parent
        : media.parent?.parent
      : null;
  const episodes =
    series === null || series === undefined
      ? []
      : await context.db.mediaItem.findMany({
          where: {
            kind: "episode",
            OR: [{ parentId: series.id }, { parent: { parentId: series.id } }],
          },
        });
  const knownEpisodes = episodes.flatMap((episode) =>
    episode.seasonNumber === null || episode.episodeNumber === null
      ? []
      : [
          {
            mediaId: episode.id,
            season: episode.seasonNumber,
            episode: episode.episodeNumber,
          },
        ],
  );
  const identity: Parameters<typeof matchRelease>[0]["media"] = {
    id: media.id,
    kind: media.kind,
    title: media.title,
    year: media.year,
  };
  if (series != null) {
    identity.seriesTitle = series.title;
    if (series.year !== null) identity.seriesYear = series.year;
  }
  if (media.seasonNumber !== null) identity.seasonNumber = media.seasonNumber;
  if (media.episodeNumber !== null)
    identity.episodeNumber = media.episodeNumber;
  return {
    identity,
    knownEpisodes,
    query: series?.title ?? media.title,
    kind: media.kind === "movie" ? ("movie" as const) : ("tv" as const),
  };
}

async function storeCandidate(
  context: MediaAutomationContext,
  candidate: ProviderCandidate,
  target: Awaited<ReturnType<typeof searchTarget>>,
  policy: { profile: QualityProfile; current: ReleaseAttributes | null },
) {
  const id = crypto.randomUUID();
  const parsed = matchRelease({
    id,
    providerId: candidate.providerId,
    title: candidate.title,
    sizeBytes: candidate.sizeBytes,
    media: target.identity,
    knownEpisodes: target.knownEpisodes,
  });
  const evaluation = chooseUpgrade({
    candidate: parsed.attributes,
    ...policy,
    mediaIds: [target.identity.id],
  });
  const stored = await context.db.releaseCandidate.upsert({
    where: {
      providerId_providerReleaseId: {
        providerId: candidate.providerId,
        providerReleaseId: candidate.providerReleaseId,
      },
    },
    create: {
      id,
      providerId: candidate.providerId,
      providerReleaseId: candidate.providerReleaseId,
      title: candidate.title,
      attributes: {
        ...parsed.attributes,
        mediaIds: [...parsed.attributes.mediaIds],
        audioLanguages: [...parsed.attributes.audioLanguages],
        scoreTags: [...parsed.attributes.scoreTags],
      },
      evaluation: evaluation.evaluation,
      mediaIds: [...parsed.attributes.mediaIds],
      encryptedSource: context.cipher.encrypt(
        JSON.stringify(candidate),
        `release:${candidate.providerId}:${candidate.providerReleaseId}`,
      ),
    },
    update: {
      evaluation: evaluation.evaluation,
      encryptedSource: context.cipher.encrypt(
        JSON.stringify(candidate),
        `release:${candidate.providerId}:${candidate.providerReleaseId}`,
      ),
    },
  });
  return evaluation.upgrade
    ? {
        id: stored.id,
        rank: evaluation.evaluation.qualityRank,
        score: evaluation.evaluation.score,
      }
    : null;
}

export async function searchCandidates(
  context: MediaAutomationContext,
  mediaId: string,
  profile: QualityProfile,
): Promise<string[]> {
  const target = await searchTarget(context, mediaId);
  const providers = await context.db.mediaProvider.findMany({
    where: { enabled: true, id: { in: ProviderIdSchema.options } },
    orderBy: { id: "asc" },
  });
  const accepted: { id: string; rank: number; score: number }[] = [];
  const current = await currentRelease(context, mediaId);
  for (const provider of providers) {
    try {
      const candidates = await context.providers.withProvider(
        provider.id,
        async (client) =>
          client.search({ query: target.query, kind: target.kind, page: 1 }),
      );
      for (const candidate of candidates) {
        const stored = await storeCandidate(context, candidate, target, {
          current,
          profile,
        });
        if (stored !== null) accepted.push(stored);
      }
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
    }
  }
  return accepted
    .sort(
      (a, b) =>
        b.rank - a.rank || b.score - a.score || a.id.localeCompare(b.id),
    )
    .map((candidate) => candidate.id);
}
