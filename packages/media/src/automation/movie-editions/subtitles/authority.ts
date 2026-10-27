import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import type { MovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { eligibleAcquisitionSponsors } from "#infrastructure/movie-editions/authority.ts";
import { currentMovieSubtitlePolicies } from "#infrastructure/movie-editions/subtitle-policy.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  distinctSubtitleTargets,
  policyRequirements,
} from "#automation/subtitles/authority.ts";
import type { SubtitleTarget } from "#domain/subtitle-quality.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** One exact cut; caption progress never changes its sibling target's authority. */
export async function currentMovieSubtitleWorkV4(
  tx: Prisma.TransactionClient,
  {
    scope: raw,
    assetId,
    epoch,
    access,
  }: {
    scope: MovieEditionScope;
    assetId: string;
    epoch: number;
    access: MovieChoiceAccess;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const scope = MovieEditionScopeSchema.parse(raw);
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: assetId },
    include: {
      subtitles: true,
      coverage: { where: { current: true }, take: 2, include: { media: true } },
    },
  });
  const target = await tx.mediaIntent.findUnique({
    where: {
      mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
    },
  });
  const policies = await currentMovieSubtitlePolicies(tx, scope, budget);
  const sponsors = await eligibleAcquisitionSponsors(tx, {
    scope,
    access,
    protocol: "movie-v4",
    budget,
  });
  const properties = z
    .object({ audioLanguages: z.array(z.string()).optional() })
    .parse(asset.properties);
  const audio = subtitleAudio(properties.audioLanguages);
  const requirements = policyRequirements(policies, audio, epoch);
  const targets: SubtitleTarget[] = sponsors.flatMap((sponsor) =>
    sponsor.request.subtitleLanguages.map((language) => ({
      language,
      hearingImpaired: "any" as const,
    })),
  );
  targets.push(...requirements.targets);
  const reasons = [...requirements.reasons];
  if (
    !asset.owned ||
    asset.ownershipEpoch !== epoch ||
    asset.state !== "published" ||
    asset.checksum === null ||
    asset.edition !== scope.edition ||
    asset.editionRootId !== scope.rootMediaId ||
    asset.coverage.length !== 1 ||
    asset.coverage[0]?.mediaId !== scope.mediaId ||
    asset.coverage[0].edition !== scope.edition ||
    asset.coverage[0].media.kind !== "movie"
  )
    reasons.push("subtitle_asset_not_authorized");
  if (
    target === null ||
    !target.desiredPresence ||
    target.intentionallyRemovedAt !== null ||
    target.automationEpoch !== epoch ||
    target.editionRootId !== scope.rootMediaId
  )
    reasons.push("subtitle_intent_not_authorized");
  const distinct = distinctSubtitleTargets(targets);
  const protectedReasons = [...new Set(reasons)].sort();
  const authority = snapshotHash({
    schemaVersion: 4,
    scope,
    assetId,
    version: asset.version,
    checksum: asset.checksum,
    epoch,
    audio,
    target:
      target === null
        ? null
        : { generation: target.generation, version: target.version },
    policies: policies.map((policy) => ({
      edition: policy.edition,
      id: policy.id,
      version: policy.version,
      epoch: policy.recoveryEpoch,
    })),
    requests: sponsors
      .map((sponsor) => ({
        id: sponsor.request.id,
        version: sponsor.request.version,
        choiceId: sponsor.choice.id,
        choiceRevision: sponsor.choice.choiceRevision,
        languages: sponsor.request.subtitleLanguages,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    targets: distinct,
    reasons: protectedReasons,
  });
  const freshness = {
    expiresAtMs:
      sponsors.length === 0
        ? Infinity
        : Math.min(...sponsors.map((sponsor) => sponsor.freshness.expiresAtMs)),
    assertActive: () => {
      for (const sponsor of sponsors) sponsor.freshness.assertActive();
    },
  };
  freshness.assertActive();
  return {
    scope,
    asset,
    target,
    targets: distinct,
    authority,
    protectedReasons,
    freshness,
  };
}

function subtitleAudio(languages: string[] | undefined) {
  return languages === undefined || languages.length === 0 ? null : languages;
}
