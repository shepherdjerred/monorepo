import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import type { IdentityConfirmation } from "#shared/acquisition/preview.ts";
import { IdentityDecisionSchema } from "#shared/acquisition/identity.ts";
import { MediaError } from "#application/errors.ts";
import { buildIdentityPreview } from "./preview.ts";
import { identityHash } from "./snapshot.ts";

export async function confirmIdentity(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  input: {
    mediaId: string;
    releaseId: string;
    confirmation: IdentityConfirmation;
    serverMachineId?: string;
  },
) {
  const preview = await buildIdentityPreview(tx, actor, {
    ...input,
    mediaIds: input.confirmation.mediaIds,
  });
  if (
    preview.previewDigest !== input.confirmation.previewDigest ||
    preview.candidateDigest !== input.confirmation.candidateDigest ||
    preview.numberingDigest !== input.confirmation.numberingDigest
  )
    throw new MediaError(
      "identity_preview_changed",
      "Release or canonical mapping changed; review again",
      409,
    );
  if (!preview.confirmationAllowed)
    throw new MediaError(
      "identity_protected",
      "Identity or quality blockers remain",
      409,
    );
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const unsigned = {
    schemaVersion: 1 as const,
    actorId: actor.id,
    releaseId: input.releaseId,
    candidateDigest: preview.candidateDigest,
    recoveryEpoch: runtime.recoveryEpoch,
    serverMachineId: input.serverMachineId,
    canonical: preview.canonical,
    coverage: preview.media.map((item) => item.id),
    reviewedMedia: preview.media.map(({ id, version, generation }) => ({
      id,
      version,
      generation,
    })),
    reason: input.confirmation.reason,
  };
  return IdentityDecisionSchema.parse({
    ...unsigned,
    evidenceHash: identityHash(unsigned),
  });
}
