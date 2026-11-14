import {
  SubtitleMatchScoreV1Schema,
  subtitleScorePercent,
  type SubtitleMatchScoreV1,
} from "#shared/subtitle-maintenance/score.ts";

export const SUBTITLE_MAINTENANCE_POLICY_V1 = {
  wantedHours: 6,
  upgradeHours: 12,
  upgradeDays: 7,
  includeManual: true,
  adaptiveAfterDays: 21,
  adaptiveRetryDays: 7,
  episodeMinimumPercent: 70,
  movieMinimumPercent: 80,
  episodeSyncBelowPercent: 96,
  movieSyncBelowPercent: 86,
} as const;
const DAY = 86_400_000;

export function subtitleSearchDueV1(input: {
  mode: "wanted" | "upgrade";
  now: Date;
  firstAttempt: Date | null;
  lastAttempt: Date | null;
}) {
  if (input.lastAttempt === null) return true;
  const adaptive =
    input.mode === "wanted" &&
    input.firstAttempt !== null &&
    input.now.getTime() - input.firstAttempt.getTime() >=
      SUBTITLE_MAINTENANCE_POLICY_V1.adaptiveAfterDays * DAY;
  const interval = adaptive
    ? SUBTITLE_MAINTENANCE_POLICY_V1.adaptiveRetryDays * DAY
    : (input.mode === "wanted"
        ? SUBTITLE_MAINTENANCE_POLICY_V1.wantedHours
        : SUBTITLE_MAINTENANCE_POLICY_V1.upgradeHours) * 3_600_000;
  return input.now.getTime() - input.lastAttempt.getTime() >= interval;
}
export function currentSubtitleUpgradeScoreV1(input: {
  createdAt: Date;
  matchingEvidence: unknown;
  now: Date;
}): SubtitleMatchScoreV1 | null {
  if (
    input.createdAt > input.now ||
    input.now.getTime() - input.createdAt.getTime() >
      SUBTITLE_MAINTENANCE_POLICY_V1.upgradeDays * DAY
  )
    return null;
  const evidence = input.matchingEvidence;
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    !("matchScoreV1" in evidence)
  )
    return null;
  const score = SubtitleMatchScoreV1Schema.parse(evidence.matchScoreV1);
  return subtitleScorePercent(score) >= 100 ? null : score;
}
