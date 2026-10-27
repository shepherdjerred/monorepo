import { defaultScope } from "#shared/editions/scope.ts";
import { networkMovieAccess } from "./editions/access.ts";
import { requireMovieSponsor } from "./editions/choice.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
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
import { currentMeasuredQuality } from "./acquisition-management/current-quality.ts";
import { EpisodeNumberingSchema } from "#shared/numbering.ts";
import { canonicalReferences } from "#infrastructure/acquisition-identity/references.ts";
import { persistCandidateSnapshot } from "./candidate-evidence.ts";
import { previewDefaultEdition } from "#infrastructure/editions/acquisition.ts";
import {
  prepareResolvedEvidence,
  collectResolvedEvidence,
} from "#migration/runtime-evidence.ts";

export async function loadProfile(
  db: MediaAutomationContext["db"],
  mediaId: string,
): Promise<QualityProfile | null> {
  const intent = await db.mediaIntent.findUniqueOrThrow({
    where: targetWhere(defaultScope(mediaId)),
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
    where: { mediaId, edition: "default", current: true },
    include: {
      asset: {
        include: {
          coverage: {
            where: { current: true },
            include: {
              media: { include: { parent: { include: { parent: true } } } },
            },
          },
        },
      },
    },
  });
  if (coverage === null) return null;
  const measured = PublicReleaseAttributesSchema.extend({
    id: z.string(),
    providerId: z.string(),
    title: z.string(),
  }).safeParse(coverage.asset.properties);
  if (measured.success)
    return currentMeasuredQuality(
      measured.data,
      coverage.asset.coverage.map((item) => item.media),
    );
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
  const knownEpisodes = episodes.flatMap((episode) => {
    const absoluteNumber = EpisodeNumberingSchema.parse(
      episode.externalIds,
    ).absoluteNumber;
    return episode.seasonNumber === null || episode.episodeNumber === null
      ? []
      : [
          {
            mediaId: episode.id,
            season: episode.seasonNumber,
            episode: episode.episodeNumber,
            ...(absoluteNumber === undefined ? {} : { absoluteNumber }),
          },
        ];
  });
  const identity: Parameters<typeof matchRelease>[0]["media"] = {
    id: media.id,
    kind: media.kind,
    title: media.title,
    year: media.year,
  };
  applyCatalogIdentity(identity, series ?? media);
  if (series != null) {
    identity.seriesTitle = series.title;
    if (series.year !== null) identity.seriesYear = series.year;
  }
  if (media.seasonNumber !== null) identity.seasonNumber = media.seasonNumber;
  if (media.episodeNumber !== null)
    identity.episodeNumber = media.episodeNumber;
  return {
    identity,
    runtimeMinutes: media.runtimeMinutes,
    originalLanguage:
      media.originalLanguage ?? series?.originalLanguage ?? null,
    knownEpisodes,
    episodeRuntimes: new Map(
      episodes.map((episode) => [episode.id, episode.runtimeMinutes]),
    ),
    query: series?.title ?? media.title,
    kind: media.kind === "movie" ? ("movie" as const) : ("tv" as const),
  };
}

async function storeCandidate(
  context: MediaAutomationContext,
  candidate: ProviderCandidate,
  target: Awaited<ReturnType<typeof searchTarget>>,
  policy: {
    profile: QualityProfile;
    current: ReleaseAttributes | null;
    matchedOnly?: boolean;
  },
) {
  const id = crypto.randomUUID();
  const parsed = matchRelease({
    id,
    providerId: candidate.providerId,
    title: candidate.title,
    sizeBytes: candidate.sizeBytes,
    media: target.identity,
    knownEpisodes: target.knownEpisodes,
    externalIds: Object.fromEntries(
      (candidate.references ?? [])
        .filter(
          (reference) =>
            reference.kind === (target.kind === "movie" ? "movie" : "series"),
        )
        .map((reference) => [reference.namespace, reference.value]),
    ),
  });
  const attributes = parsed.attributes;
  const references = candidate.references ?? [];
  if (
    references.some(
      (reference) =>
        reference.kind !== (target.kind === "movie" ? "movie" : "series") ||
        references.some(
          (other) =>
            other.namespace === reference.namespace &&
            other.value !== reference.value,
        ),
    )
  )
    attributes.identityConfidence = "mismatch";
  if (
    policy.matchedOnly === true &&
    (attributes.identityConfidence !== "exact" ||
      !attributes.mediaIds.includes(target.identity.id))
  )
    return null;
  if (policy.profile.resolved !== undefined) {
    attributes.resolvedEvidence = await collectResolvedEvidence(
      policy.profile.resolved,
      prepareResolvedEvidence(policy.profile.resolved, {
        id,
        title: candidate.title,
        identityConfirmed: attributes.identityConfidence === "exact",
        sizeBytes: candidate.sizeBytes,
        // Pack runtime is the sum of known episodes, never the requested leaf's duration.
        runtimeMinutes:
          attributes.mediaIds.length === 1
            ? target.runtimeMinutes
            : packRuntime(target.episodeRuntimes, attributes.mediaIds),
        originalLanguage: target.originalLanguage,
        audioLanguages:
          attributes.audioLanguages.length > 0
            ? [...attributes.audioLanguages]
            : null,
        specialEpisode: target.identity.seasonNumber === 0,
      }),
    );
  }
  const evaluation = chooseUpgrade({
    candidate: attributes,
    ...policy,
    mediaIds: [target.identity.id],
  });
  const stored = await persistCandidateSnapshot(context, {
    source: candidate,
    attributes,
    evaluation: evaluation.evaluation,
    searchedForMediaId: target.identity.id,
  });
  if (stored === null) return null;
  const edition = await previewDefaultEdition(context.db, {
    releaseId: stored.id,
    mediaIds:
      stored.mediaIds.length === 0 ? [target.identity.id] : stored.mediaIds,
  });
  if (!edition.accepted) return null;
  const authoritative = chooseUpgrade({
    candidate: stored,
    ...policy,
    mediaIds: [target.identity.id],
  });
  return authoritative.upgrade
    ? {
        id: stored.id,
        rank: authoritative.evaluation.qualityRank,
        score: authoritative.evaluation.score,
      }
    : null;
}
function packRuntime(
  runtimes: ReadonlyMap<string, number | null>,
  coverage: readonly string[],
) {
  let sum = 0;
  if (coverage.length === 0) return null;
  for (const id of coverage) {
    const runtime = runtimes.get(id);
    if (runtime == null) return null;
    sum += runtime;
  }
  return sum;
}

/** A broad feed must prove canonical coverage before retaining a target-specific interpretation. */
export async function assessDefaultFeedCandidate(
  context: MediaAutomationContext,
  mediaId: string,
  source: ProviderCandidate,
) {
  const profile = await loadProfile(context.db, mediaId);
  if (profile === null) return null;
  const target = await searchTarget(context, mediaId);
  const selected = await storeCandidate(context, source, target, {
    profile,
    current: await currentRelease(context, mediaId),
    matchedOnly: true,
  });
  return selected === null
    ? null
    : { ...selected, profileId: profile.id, profileVersion: profile.version };
}

export async function searchCandidates(
  context: MediaAutomationContext,
  mediaId: string,
  profile: QualityProfile,
): Promise<string[]> {
  const movieAccess = await networkMovieAccess(context, [mediaId]);
  await requireMovieSponsor(context.db, mediaId, movieAccess);
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
        async (client) => {
          const sponsor = await requireMovieSponsor(
            context.db,
            mediaId,
            movieAccess,
          );
          sponsor?.freshness.assertActive();
          return client.search({
            query: target.query,
            kind: target.kind,
            page: 1,
          });
        },
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
function applyCatalogIdentity(
  identity: Parameters<typeof matchRelease>[0]["media"],
  catalogRoot: { kind: string; tmdbId: number | null; externalIds: unknown },
) {
  const catalog = canonicalReferences(catalogRoot);
  identity.aliases = catalog.aliases;
  identity.externalIds = Object.fromEntries(
    catalog.references.map((reference) => [
      reference.namespace,
      reference.value,
    ]),
  );
}
