import type { RoundRobinSeriesResult } from "@scout-for-lol/data";

export type RoundRobinSeries = {
  readonly id: string;
  readonly roundNumber: number | null;
  readonly createdAt: Date;
  readonly competitorOneId: string;
  readonly competitorTwoId: string;
  readonly winnerCompetitorId: string | null;
  readonly games: readonly { readonly winnerCompetitorId: string | null }[];
};

/**
 * Tiebreak rematches replace the original meeting for their competitor pair.
 * Keep only the latest series so every caller uses the same decisive result.
 */
export function latestRoundRobinResults(
  series: readonly RoundRobinSeries[],
): RoundRobinSeriesResult[] {
  const latestByMatchup = new Map<string, RoundRobinSeries>();
  for (const candidate of series.toSorted(
    (left, right) =>
      (left.roundNumber ?? 0) - (right.roundNumber ?? 0) ||
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id),
  )) {
    const matchup = [candidate.competitorOneId, candidate.competitorTwoId]
      .toSorted()
      .join(":");
    latestByMatchup.set(matchup, candidate);
  }
  return [...latestByMatchup.values()].flatMap((candidate) => {
    if (candidate.winnerCompetitorId === null) return [];
    return [
      {
        firstCompetitorId: candidate.competitorOneId,
        secondCompetitorId: candidate.competitorTwoId,
        winnerCompetitorId: candidate.winnerCompetitorId,
        firstGameWins: candidate.games.filter(
          (game) => game.winnerCompetitorId === candidate.competitorOneId,
        ).length,
        secondGameWins: candidate.games.filter(
          (game) => game.winnerCompetitorId === candidate.competitorTwoId,
        ).length,
      },
    ];
  });
}
