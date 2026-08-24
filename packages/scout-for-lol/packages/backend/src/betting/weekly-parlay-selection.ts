import {
  WEEKLY_PARLAY_FEATURE_COOLDOWN_PERIODS,
  WEEKLY_PARLAY_MIN_HISTORY_WINDOWS,
  WEEKLY_PARLAY_MIN_RECENT_GAMES,
} from "#src/betting/weekly-parlay-criteria.ts";

export type WeeklyParlayCandidate = {
  playerId: number;
  linkedGuildMember: boolean;
  recentEligibleGames: number;
  fullyObservedWindows: number;
  periodsSinceFeatured: number | null;
};

export function orderWeeklyParlayCandidates(
  candidates: readonly WeeklyParlayCandidate[],
): WeeklyParlayCandidate[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.linkedGuildMember &&
        candidate.recentEligibleGames >= WEEKLY_PARLAY_MIN_RECENT_GAMES &&
        candidate.fullyObservedWindows >= WEEKLY_PARLAY_MIN_HISTORY_WINDOWS &&
        (candidate.periodsSinceFeatured === null ||
          candidate.periodsSinceFeatured >=
            WEEKLY_PARLAY_FEATURE_COOLDOWN_PERIODS),
    )
    .toSorted((left, right) => {
      const leftPeriods = left.periodsSinceFeatured ?? Number.MAX_SAFE_INTEGER;
      const rightPeriods =
        right.periodsSinceFeatured ?? Number.MAX_SAFE_INTEGER;
      return (
        rightPeriods - leftPeriods ||
        right.recentEligibleGames - left.recentEligibleGames ||
        left.playerId - right.playerId
      );
    });
}
