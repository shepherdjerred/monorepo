import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { currentSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  subtitleAccepted,
  type SubtitleTarget,
} from "#domain/subtitle-quality.ts";

export const SubtitleTargetSchema = z.object({
  language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/u),
  forced: z.boolean().optional(),
  hearingImpaired: z.enum(["required", "excluded", "any"]).optional(),
});
export const SubtitleWorkSchema = SubtitleTargetSchema.extend({
  targetAuthority: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
});
export function targetKey(target: SubtitleTarget): string {
  return `${target.language}:${target.forced === undefined ? "any" : target.forced ? "forced" : "regular"}:${target.hearingImpaired ?? "any"}`;
}

function policyRequirements(
  policies: Awaited<ReturnType<typeof currentSubtitlePolicies>>,
  audio: string[] | null,
  epoch: number,
) {
  const targets: SubtitleTarget[] = [];
  const reasons: string[] = [];
  for (const policy of policies) {
    reasons.push(...policy.rules.protectedReasons);
    if (policy.recoveryEpoch !== epoch)
      reasons.push("subtitle_policy_epoch_unconfirmed");
    for (const target of policy.rules.targets) {
      if (audio === null && target.audio !== "any") {
        reasons.push("subtitle_audio_evidence_unknown");
        continue;
      }
      const matches = audio?.includes(target.audioLanguage) === true;
      if (
        (matches && target.audio === "exclude_matching") ||
        (!matches && target.audio === "only_matching")
      )
        continue;
      targets.push({
        language: target.language,
        forced: target.forced,
        hearingImpaired: target.hearingImpaired,
      });
    }
  }
  return { targets, reasons };
}

/** The digest excludes subtitle progress; one completed target cannot obsolete its sibling. */
export async function currentSubtitleWork(
  tx: Prisma.TransactionClient,
  assetId: string,
  epoch: number,
) {
  const asset = await tx.libraryAsset.findUniqueOrThrow({
    where: { id: assetId },
    include: {
      subtitles: true,
      coverage: {
        where: { current: true },
        include: { media: { include: { intent: true } } },
      },
    },
  });
  const ids = asset.coverage.map((item) => item.mediaId).sort();
  const policies = await currentSubtitlePolicies(tx, ids);
  const requests = await tx.mediaRequest.findMany({
    where: { mediaId: { in: ids }, ...effectiveRequestWhere },
    orderBy: { id: "asc" },
  });
  const properties = z
    .object({ audioLanguages: z.array(z.string()).optional() })
    .parse(asset.properties);
  const languages = properties.audioLanguages ?? [];
  const audio = languages.length > 0 ? languages : null;
  const targets: SubtitleTarget[] = requests.flatMap((request) =>
    request.subtitleLanguages.map((language) => ({
      language,
      hearingImpaired: "any" as const,
    })),
  );
  const requirements = policyRequirements(policies, audio ?? null, epoch);
  const { reasons } = requirements;
  targets.push(...requirements.targets);
  if (
    !asset.owned ||
    asset.ownershipEpoch !== epoch ||
    asset.state !== "published" ||
    asset.checksum === null ||
    ids.length === 0
  )
    reasons.push("subtitle_asset_not_authorized");
  if (
    asset.coverage.some(
      (item) =>
        item.media.intent?.desiredPresence !== true ||
        item.media.intent.automationEpoch !== epoch,
    )
  )
    reasons.push("subtitle_intent_not_authorized");
  const distinct = [
    ...new Map(targets.map((target) => [targetKey(target), target])).values(),
  ];
  const unique = distinct
    .filter(
      (target) =>
        target.forced !== undefined ||
        !distinct.some(
          (other) =>
            other.language === target.language && other.forced !== undefined,
        ),
    )
    .filter(
      (target) =>
        target.hearingImpaired !== "any" ||
        !distinct.some(
          (other) =>
            other.language === target.language &&
            other.forced === target.forced &&
            other.hearingImpaired !== "any",
        ),
    )
    .sort((a, b) => targetKey(a).localeCompare(targetKey(b)));
  const authority = snapshotHash({
    assetId,
    version: asset.version,
    checksum: asset.checksum,
    epoch,
    audio,
    coverage: asset.coverage
      .map((item) => ({
        mediaId: item.mediaId,
        generation: item.media.intent?.generation ?? null,
      }))
      .sort((a, b) => a.mediaId.localeCompare(b.mediaId)),
    policies: policies
      .map((policy) => ({
        mediaId: policy.mediaId,
        id: policy.id,
        version: policy.version,
        epoch: policy.recoveryEpoch,
      }))
      .sort((a, b) => a.mediaId.localeCompare(b.mediaId)),
    requests: requests.map((request) => ({
      id: request.id,
      version: request.version,
      languages: request.subtitleLanguages,
    })),
    targets: unique,
    reasons: [...new Set(reasons)].sort(),
  });
  return {
    asset,
    targets: unique,
    authority,
    protectedReasons: [...new Set(reasons)],
  };
}

export function targetRequired(
  work: Awaited<ReturnType<typeof currentSubtitleWork>>,
  target: SubtitleTarget,
): boolean {
  return work.targets.some(
    (required) => targetKey(required) === targetKey(target),
  );
}
export function reusableSubtitle(
  subtitle: Awaited<
    ReturnType<typeof currentSubtitleWork>
  >["asset"]["subtitles"][number],
  work: Awaited<ReturnType<typeof currentSubtitleWork>>,
  epoch: number,
  target: SubtitleTarget,
): boolean {
  if (
    !subtitleAccepted({
      subtitle,
      asset: work.asset,
      epoch,
      target,
      allowStaged: true,
    })
  )
    return false;
  if (subtitle.state === "installed") return true;
  if (
    z
      .object({ replacementFor: z.unknown() })
      .safeParse(subtitle.matchingEvidence).success
  )
    return false;
  const binding = z
    .object({ targetAuthority: z.literal(work.authority) })
    .safeParse(subtitle.matchingEvidence);
  return binding.success;
}
export function subtitleTargetsReady(
  work: Awaited<ReturnType<typeof currentSubtitleWork>>,
  epoch: number,
): boolean {
  return (
    work.protectedReasons.length === 0 &&
    work.targets.every((target) =>
      work.asset.subtitles.some((subtitle) =>
        subtitleAccepted({ subtitle, asset: work.asset, epoch, target }),
      ),
    )
  );
}
