import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import { chooseUpgrade } from "#domain/quality.ts";
import { providerCandidateAdmission } from "#automation/provider-selection.ts";
import { candidateUpgradeAllowed } from "./quality.ts";

export async function reserveProviderUpgradeAllowed(
  context: MediaAutomationContext,
  input: Parameters<typeof candidateUpgradeAllowed>[1] & { mediaId: string },
  tx: Prisma.TransactionClient,
) {
  if (!(await candidateUpgradeAllowed(context, input))) return false;
  const listing = {
    candidate: {
      id: input.release.id,
      providerId: input.release.providerId,
      title: input.release.title,
      ...PublicReleaseAttributesSchema.parse(input.release.attributes),
    },
    current: null,
    profile: input.profile,
    mediaIds: input.mediaIds,
    phase: "listing" as const,
  };
  const admission = await providerCandidateAdmission(
    context,
    {
      releaseId: input.release.id,
      mediaId: input.mediaId,
      profile: input.profile,
      rank: chooseUpgrade(listing).evaluation.qualityRank,
    },
    tx,
  );
  return admission.accepted;
}

export async function reserveMovieProviderUpgradeAllowed(
  context: MediaAutomationContext,
  input: Parameters<typeof chooseUpgrade>[0] & {
    mediaId: string;
    releaseId: string;
    edition: string;
  },
  tx: Prisma.TransactionClient,
) {
  const listing = { ...input, phase: "listing" as const };
  const chosen = chooseUpgrade(listing);
  if (!chosen.upgrade) return false;
  const admission = await providerCandidateAdmission(
    context,
    {
      releaseId: input.releaseId,
      mediaId: input.mediaId,
      edition: input.edition,
      profile: input.profile,
      rank: chosen.evaluation.qualityRank,
    },
    tx,
  );
  return admission.accepted;
}
