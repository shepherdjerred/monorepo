import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import type { ReleaseCandidate } from "#generated/prisma/client.ts";
import type { QualityProfile } from "#shared/contract.ts";
import type { DefaultAcquisitionIdentity } from "#shared/acquisition/library-management.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { effectiveCandidate } from "#domain/acquisition-identity/effective.ts";
import { chooseUpgrade } from "#domain/quality.ts";
import { currentRelease } from "#automation/acquisition-candidates.ts";

/** Every episode in a pack must improve under the actual captured profile. */
export async function candidateUpgradeAllowed(
  context: MediaAutomationContext,
  input: {
    release: ReleaseCandidate;
    identity: DefaultAcquisitionIdentity | null;
    profile: QualityProfile;
    mediaIds: string[];
  },
) {
  const raw = {
    id: input.release.id,
    providerId: input.release.providerId,
    title: input.release.title,
    ...PublicReleaseAttributesSchema.parse(input.release.attributes),
  };
  const candidate =
    input.identity === null ? raw : effectiveCandidate(raw, input.identity);
  for (const mediaId of input.mediaIds)
    if (
      !chooseUpgrade({
        candidate,
        current: await currentRelease(context, mediaId),
        profile: input.profile,
        mediaIds: [mediaId],
      }).upgrade
    )
      return false;
  return true;
}
