import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { subtitlePolicySatisfaction } from "#domain/subtitle-policy.ts";
import type {
  SubtitleQuality,
  SubtitleVideo,
} from "#domain/subtitle-quality.ts";
import { SubtitlePolicySchema } from "#shared/subtitle-policy.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import type { householdCaptionRequirements } from "#infrastructure/quality-guide/captions.ts";

/** Acquire after media and runtime locks, before policy reads or writes. */
export async function lockSubtitlePolicies(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('media-subtitle-policy',0))::text`;
}

export function policyStatus(input: {
  policy:
    Awaited<ReturnType<typeof currentSubtitlePolicies>>[number] | undefined;
  asset: SubtitleVideo & {
    properties: Prisma.JsonValue;
    subtitles: SubtitleQuality[];
  };
  epoch: number;
  household?: Awaited<ReturnType<typeof householdCaptionRequirements>>;
}) {
  if (input.policy === undefined && input.household?.binding == null)
    return null;
  const properties = z
    .object({ audioLanguages: z.array(z.string()).optional() })
    .parse(input.asset.properties);
  const result = subtitlePolicySatisfaction({
    rules:
      input.policy === undefined
        ? { schemaVersion: 1, targets: [], protectedReasons: [] }
        : input.policy.rules,
    subtitles: input.asset.subtitles,
    asset: input.asset,
    epoch: input.epoch,
    audioLanguages:
      properties.audioLanguages === undefined ||
      properties.audioLanguages.length === 0
        ? null
        : properties.audioLanguages,
  });
  const householdMissing =
    input.household?.targets.filter(
      (target) =>
        !input.asset.subtitles.some((subtitle) =>
          subtitleAccepted({
            subtitle,
            asset: input.asset,
            epoch: input.epoch,
            target,
          }),
        ),
    ) ?? [];
  const reasons = [
    ...result.protectedReasons,
    ...(input.household?.reasons ?? []),
  ];
  if (input.policy !== undefined && input.policy.recoveryEpoch !== input.epoch)
    reasons.push("subtitle_policy_epoch_unconfirmed");
  return {
    ...result,
    householdMissing,
    protectedReasons: [...new Set(reasons)],
    satisfied:
      result.satisfied && householdMissing.length === 0 && reasons.length === 0,
  };
}

export async function currentSubtitlePolicies(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
) {
  const select = {
    where: { edition: "default" },
    orderBy: { version: "desc" as const },
    take: 1,
  };
  const media = await tx.mediaItem.findMany({
    where: { id: { in: [...mediaIds] } },
    include: {
      subtitlePolicies: select,
      parent: {
        include: {
          subtitlePolicies: select,
          parent: { include: { subtitlePolicies: select } },
        },
      },
    },
  });
  return media.flatMap((item) => {
    const policy =
      item.subtitlePolicies[0] ??
      item.parent?.subtitlePolicies[0] ??
      item.parent?.parent?.subtitlePolicies[0];
    return policy === undefined
      ? []
      : [
          {
            mediaId: item.id,
            id: policy.id,
            version: policy.version,
            recoveryEpoch: policy.recoveryEpoch,
            rules: SubtitlePolicySchema.parse(policy.rules),
          },
        ];
  });
}
