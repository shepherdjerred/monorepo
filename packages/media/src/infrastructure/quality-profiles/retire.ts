import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { lockCommandActor } from "#infrastructure/editions/command-actor.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import type { QualityGuideKind } from "#shared/quality-guide/contract.ts";

export type RetireProfile = {
  expectedVersion: number;
  replacementId: string;
  kind: QualityGuideKind;
};

export async function retireQualityProfile(
  db: Prisma.TransactionClient,
  actor: MediaActor,
  profileId: string,
  input: RetireProfile,
) {
  requireOwner(await lockCommandActor(db, actor));
  const profile = await db.qualityProfile.findUnique({
    where: { id: profileId },
    include: { defaults: { select: { kind: true } } },
  });
  if (
    profile?.version !== input.expectedVersion ||
    profile.replacedByProfileId !== null
  )
    throw new MediaError(
      "version_conflict",
      "The quality profile changed",
      409,
    );
  const replacement = await db.qualityProfile.findUnique({
    where: { id: input.replacementId },
  });
  if (
    replacement?.replacedByProfileId !== null ||
    QualityRulesSchema.parse(replacement.rules).managedGuide?.kind !==
      input.kind ||
    QualityRulesSchema.parse(profile.rules).managedGuide !== undefined
  )
    throw new MediaError(
      "profile_replacement_invalid",
      "Choose a matching TRaSH profile",
      422,
    );
  if (profile.defaults.length > 0)
    throw new MediaError(
      "profile_is_default",
      "Change the library default before retiring this profile",
      409,
    );
  const otherKind = await db.mediaIntent.findFirst({
    where: {
      profileId,
      media:
        input.kind === "movie" ? { kind: { not: "movie" } } : { kind: "movie" },
    },
    select: { mediaId: true },
  });
  if (otherKind !== null)
    throw new MediaError(
      "profile_replacement_invalid",
      "The retired profile covers a different media kind",
      422,
    );
  await db.qualityProfile.update({
    where: { id: profileId },
    data: { replacedByProfileId: replacement.id },
  });
  await db.applicationEvent.create({
    data: {
      actorId: actor.id,
      kind: "quality_profile_retired",
      payload: {
        profileId,
        replacementId: replacement.id,
        mediaKind: input.kind,
      },
    },
  });
  return { profileId, status: "completed" };
}
