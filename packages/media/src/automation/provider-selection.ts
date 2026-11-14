import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "./context.ts";
import {
  ProviderConfigurationSchema,
  defaultProviderConfiguration,
} from "#shared/admin.ts";
import type { QualityProfile } from "#shared/contract.ts";
import { evaluateProviderSelection } from "#domain/provider-selection.ts";
import { StoredCandidateSchema } from "./providers.ts";
import {
  observedProviderSeeders,
  ProviderAvailabilitySchema,
} from "#domain/provider-availability.ts";
import { queueOperation } from "./store.ts";
import { candidateDigest } from "#infrastructure/acquisition-identity/snapshot.ts";

export function highestProviderQualityRank(profile: QualityProfile) {
  return profile.resolved === undefined
    ? profile.qualities.length - 1
    : Math.max(
        -1,
        ...profile.resolved.profile.items.flatMap((item, rank) =>
          item.allowed &&
          ("quality" in item || item.items.some((leaf) => leaf.allowed))
            ? [rank]
            : [],
        ),
      );
}

export async function selectProviderCandidate(
  context: MediaAutomationContext,
  input: Parameters<typeof providerCandidateAdmission>[1] & {
    upgrade: boolean;
    score: number;
  },
) {
  if (!input.upgrade) return null;
  const admission = await providerCandidateAdmission(context, input);
  return admission.accepted
    ? {
        id: input.releaseId,
        rank: input.rank,
        score: input.score,
        priority: admission.priority,
      }
    : null;
}

export async function providerCandidateAdmission(
  context: MediaAutomationContext,
  input: {
    releaseId: string;
    mediaId: string;
    edition?: string;
    rank: number;
    profile: QualityProfile;
  },
  transaction?: Prisma.TransactionClient,
): Promise<{
  accepted: boolean;
  reason: string | null;
  eligibleAt: number | null;
  priority: number;
}> {
  if (transaction === undefined)
    return context.db.$transaction((tx) =>
      providerCandidateAdmission(context, input, tx),
    );
  const budget =
    context.movieManagement?.budget ?? context.libraryManagement?.budget;
  budget?.consume(4);
  const release = await transaction.releaseCandidate.findUniqueOrThrow({
    where: { id: input.releaseId },
  });
  const provider = await transaction.mediaProvider.findUniqueOrThrow({
    where: { id: release.providerId },
  });
  const configuration = ProviderConfigurationSchema.parse({
    ...defaultProviderConfiguration,
    ...z.record(z.string(), z.unknown()).parse(provider.configuration),
  });
  const policy = configuration.selection ?? {
    priority: 25,
    minimumSeeders: 0,
    delaySeconds: 0,
    bypassAtHighestQuality: false,
  };
  if (!provider.enabled)
    return {
      accepted: false,
      reason: "provider_disabled",
      eligibleAt: null,
      priority: policy.priority,
    };
  const failed = await transaction.acquisitionAttempt.findFirst({
    where: {
      releaseId: release.id,
      edition: input.edition ?? "default",
      mediaIds: { has: input.mediaId },
      state: { in: ["failed", "rejected"] },
      AND: [
        {
          failure: { path: ["contentRejectionV1", "schemaVersion"], equals: 1 },
        },
        {
          failure: {
            path: ["contentRejectionV1", "profileId"],
            equals: input.profile.id,
          },
        },
        {
          failure: {
            path: ["contentRejectionV1", "profileVersion"],
            equals: input.profile.version,
          },
        },
      ],
    },
    select: { id: true, failure: true },
  });
  if (failed !== null) {
    const proof = z
      .object({
        contentRejectionV1: z.object({
          releaseId: z.literal(release.id),
          releaseDigest: z.string().regex(/^[a-f0-9]{64}$/u),
        }),
      })
      .parse(failed.failure);
    if (proof.contentRejectionV1.releaseDigest !== candidateDigest(release))
      throw new Error("Rejected release lost its actual source identity");
  }
  const rejectedAsset = await transaction.libraryAsset.findFirst({
    where: {
      state: "rejected",
      properties: { path: ["releaseId"], equals: release.id },
      coverage: {
        some: { mediaId: input.mediaId, edition: input.edition ?? "default" },
      },
    },
    select: { id: true },
  });
  const availability =
    release.availability ?? legacyAvailability(context, release);
  const seeders =
    availability === null
      ? null
      : observedProviderSeeders(availability, release, Date.now());
  const result = evaluateProviderSelection({
    policy,
    seeders,
    firstSeenAt: release.createdAt.getTime(),
    now: context.now?.().getTime() ?? Date.now(),
    qualityRank: input.rank,
    highestQualityRank: highestProviderQualityRank(input.profile),
    rejected: failed !== null || rejectedAsset !== null,
  });
  if (result.eligibleAt !== null) {
    budget?.consume(2);
    await queueDelayRecheck(transaction, input, new Date(result.eligibleAt));
  }
  return { ...result, priority: policy.priority };
}

function legacyAvailability(
  context: MediaAutomationContext,
  release: {
    providerId: string;
    providerReleaseId: string;
    createdAt: Date;
    encryptedSource: string | null;
  },
) {
  if (release.encryptedSource === null) return null;
  const source = StoredCandidateSchema.parse(
    JSON.parse(
      context.cipher.decrypt(
        release.encryptedSource,
        `release:${release.providerId}:${release.providerReleaseId}`,
      ),
    ),
  );
  return ProviderAvailabilitySchema.parse({
    schemaVersion: 1,
    version: 0,
    providerId: source.providerId,
    providerReleaseId: source.providerReleaseId,
    seeders: source.seeders,
    observedAt: release.createdAt.toISOString(),
  });
}

async function queueDelayRecheck(
  tx: Prisma.TransactionClient,
  input: {
    mediaId: string;
    edition?: string;
    releaseId: string;
    profile: QualityProfile;
  },
  eligibleAt: Date,
) {
  const target = await tx.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: input.mediaId,
        edition: input.edition ?? "default",
      },
    },
    include: { media: true },
  });
  const movie = target.media.kind === "movie";
  const payload: Prisma.InputJsonObject = {
    mediaId: target.mediaId,
    generation: target.generation,
    ...(movie
      ? {
          schemaVersion: 4,
          scope: {
            mediaId: target.mediaId,
            rootMediaId: target.editionRootId ?? target.mediaId,
            edition: target.edition,
          },
        }
      : {}),
  };
  await queueOperation(tx, {
    key: `provider-delay:${input.releaseId}:${target.mediaId}:${target.edition}:${String(target.generation)}:${input.profile.id}:${String(input.profile.version)}:${String(eligibleAt.getTime())}`,
    kind: movie ? "reconcile_movie_edition_v4" : "reconcile_media",
    targetId: target.mediaId,
    payload,
    availableAt: eligibleAt,
  });
}
