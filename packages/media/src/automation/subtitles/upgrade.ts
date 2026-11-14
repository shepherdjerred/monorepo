import { z } from "zod";
import {
  SubtitleMatchScoreV1Schema,
  SubtitleUpgradeV1Schema,
  subtitleScorePercent,
  type SubtitleUpgradeV1,
  type SubtitleScoreReferenceV1,
} from "#shared/subtitle-maintenance/score.ts";
import { subtitleScoreReferenceHashV1 } from "#domain/subtitle-maintenance/score.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  reusableSubtitle,
  targetRequired,
  type SubtitleWork,
} from "./authority.ts";
import {
  subtitleAccepted,
  type SubtitleTarget,
} from "#domain/subtitle-quality.ts";
type CandidateSubtitleWork = Omit<SubtitleWork, "asset"> & {
  asset: Omit<SubtitleWork["asset"], "subtitles"> & {
    subtitles: Parameters<typeof reusableSubtitle>[0][];
  };
};

export function assertSubtitleUpgradeOperationV1(
  payload: unknown,
  input: { assetId: string; upgradeV1?: SubtitleUpgradeV1 },
) {
  if (input.upgradeV1 === undefined) return;
  const recorded = z
    .object({
      assetId: z.literal(input.assetId),
      upgradeV1: SubtitleUpgradeV1Schema,
    })
    .parse(payload);
  if (identityHash(recorded.upgradeV1) !== identityHash(input.upgradeV1))
    throw new Error("Subtitle upgrade command changed");
}

export function subtitleUpgradeCurrentV1(
  work: SubtitleWork,
  raw: SubtitleUpgradeV1 | undefined,
  target: SubtitleTarget,
): boolean {
  if (raw === undefined) return true;
  const upgrade = SubtitleUpgradeV1Schema.parse(raw);
  const old = work.asset.subtitles.find(
    (row) => row.id === upgrade.oldSubtitleId,
  );
  if (
    old?.state !== "installed" ||
    old.qualityStatus !== "accepted" ||
    old.checksum !== upgrade.oldChecksum
  )
    return false;
  if (
    !subtitleAccepted({
      subtitle: old,
      asset: work.asset,
      epoch: work.asset.ownershipEpoch,
      target,
    })
  )
    return false;
  const version = z
    .object({ version: z.int().nonnegative() })
    .parse(old).version;
  const score = z
    .object({ matchScoreV1: SubtitleMatchScoreV1Schema })
    .safeParse(old.matchingEvidence);
  return (
    version === upgrade.oldVersion &&
    score.success &&
    identityHash(score.data.matchScoreV1) === identityHash(upgrade.minimumScore)
  );
}

export function subtitleCandidateWorkCurrentV1(
  work: SubtitleWork,
  target: SubtitleTarget,
  authority: string,
  upgrade?: SubtitleUpgradeV1,
) {
  return (
    work.authority === authority &&
    work.protectedReasons.length === 0 &&
    targetRequired(work, target) &&
    subtitleUpgradeCurrentV1(work, upgrade, target)
  );
}

export function subtitleScoreEvidenceV1(source: { matchScoreV1?: unknown }) {
  return source.matchScoreV1 === undefined
    ? {}
    : { matchScoreV1: SubtitleMatchScoreV1Schema.parse(source.matchScoreV1) };
}

export function rejectedSubtitleChecksumsV1(
  work: SubtitleWork,
  epoch: number,
  reference?: SubtitleScoreReferenceV1 | null,
) {
  const referenceHash =
    reference == null ? null : subtitleScoreReferenceHashV1(reference);
  return work.asset.subtitles
    .filter(
      (subtitle) =>
        subtitle.qualityStatus === "rejected" &&
        subtitle.ownershipEpoch === epoch &&
        subtitle.videoChecksum === work.asset.checksum &&
        subtitle.videoVersion === work.asset.version &&
        (referenceHash === null ||
          (() => {
            const score = z
              .object({ matchScoreV1: SubtitleMatchScoreV1Schema })
              .safeParse(subtitle.matchingEvidence);
            return (
              score.success &&
              score.data.matchScoreV1.referenceHash === referenceHash
            );
          })()),
    )
    .flatMap((subtitle) =>
      subtitle.checksum === null ? [] : [subtitle.checksum],
    );
}

export function findReusableSubtitleV1(
  work: CandidateSubtitleWork,
  epoch: number,
  target: SubtitleTarget,
  upgrade?: SubtitleUpgradeV1,
) {
  return work.asset.subtitles.find((subtitle) => {
    if (
      !reusableSubtitle(subtitle, work, epoch, target) &&
      !awaitingMeasurement(subtitle, work, epoch, target)
    )
      return false;
    if (upgrade === undefined) return true;
    if (subtitle.state !== "validated" || subtitle.id === upgrade.oldSubtitleId)
      return false;
    const score = z
      .object({ matchScoreV1: SubtitleMatchScoreV1Schema })
      .safeParse(subtitle.matchingEvidence);
    return (
      score.success &&
      score.data.matchScoreV1.referenceHash ===
        upgrade.minimumScore.referenceHash &&
      subtitleScorePercent(score.data.matchScoreV1) >
        subtitleScorePercent(upgrade.minimumScore)
    );
  });
}

function awaitingMeasurement(
  subtitle: SubtitleWork["asset"]["subtitles"][number],
  work: SubtitleWork,
  epoch: number,
  target: SubtitleTarget,
) {
  const evidence = z
    .object({
      regularDialogueRequiredV1: z.literal(true),
      targetAuthority: z.literal(work.authority),
    })
    .safeParse(subtitle.matchingEvidence);
  return (
    evidence.success &&
    subtitle.state === "validated" &&
    subtitle.forced === null &&
    target.forced === false &&
    ["en", "zh-Hans", "zh-CN"].includes(target.language) &&
    subtitleAccepted({
      subtitle,
      asset: work.asset,
      epoch,
      target: {
        language: target.language,
        ...(target.hearingImpaired === undefined
          ? {}
          : { hearingImpaired: target.hearingImpaired }),
      },
      allowStaged: true,
    })
  );
}
