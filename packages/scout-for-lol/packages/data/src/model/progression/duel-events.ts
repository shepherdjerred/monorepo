import {
  DuelStandingSchema,
  type DuelStanding,
} from "#src/model/progression/duel.ts";

export type DuelSeedMethod = "manual" | "random" | "rolling_record";

function stableSeedValue(seed: string, entrantId: string): number {
  let value = 2_166_136_261;
  for (const character of `${seed}:${entrantId}`) {
    value ^= character.codePointAt(0) ?? 0;
    value = Math.imul(value, 16_777_619);
  }
  return value >>> 0;
}

export function seedDuelEntrants(
  entrantIds: readonly string[],
  method: DuelSeedMethod,
  rollingWins: Readonly<Record<string, number>>,
  randomSeed: string,
): string[] {
  if (method === "manual") return [...entrantIds];
  if (method === "random") {
    return entrantIds.toSorted(
      (left, right) =>
        stableSeedValue(randomSeed, left) -
          stableSeedValue(randomSeed, right) || left.localeCompare(right),
    );
  }
  return entrantIds.toSorted(
    (left, right) =>
      (rollingWins[right] ?? 0) - (rollingWins[left] ?? 0) ||
      left.localeCompare(right),
  );
}

function nextPowerOfTwo(value: number): number {
  let size = 1;
  while (size < value) size *= 2;
  return size;
}

function standardSeedSlots(size: number): number[] {
  let slots = [1, 2];
  while (slots.length < size) {
    const nextSize = slots.length * 2;
    slots = slots.flatMap((seed) => [seed, nextSize + 1 - seed]);
  }
  return slots;
}

export type DuelBracketPairing = {
  position: number;
  firstEntrantId: string | null;
  secondEntrantId: string | null;
  byeWinnerEntrantId: string | null;
};

export function createEliminationFirstRound(
  seededEntrantIds: readonly string[],
): DuelBracketPairing[] {
  if (seededEntrantIds.length < 2 || seededEntrantIds.length > 64) {
    throw new Error("Elimination events require between 2 and 64 entrants");
  }
  const size = nextPowerOfTwo(seededEntrantIds.length);
  const slots = standardSeedSlots(size).map(
    (seed) => seededEntrantIds[seed - 1] ?? null,
  );
  const pairings: DuelBracketPairing[] = [];
  for (let index = 0; index < slots.length; index += 2) {
    const firstEntrantId = slots[index] ?? null;
    const secondEntrantId = slots[index + 1] ?? null;
    pairings.push({
      position: index / 2,
      firstEntrantId,
      secondEntrantId,
      byeWinnerEntrantId:
        firstEntrantId === null
          ? secondEntrantId
          : secondEntrantId === null
            ? firstEntrantId
            : null,
    });
  }
  return pairings;
}

export type DoubleEliminationFinalState =
  | { kind: "pending" }
  | { kind: "reset_required" }
  | { kind: "completed"; winnerCompetitorId: string };

export function resolveDoubleEliminationGrandFinal(
  winnersBracketCompetitorId: string,
  losersBracketCompetitorId: string,
  firstFinalWinnerId: string | null,
  resetFinalWinnerId: string | null,
): DoubleEliminationFinalState {
  if (firstFinalWinnerId === null) return { kind: "pending" };
  if (firstFinalWinnerId === winnersBracketCompetitorId) {
    return { kind: "completed", winnerCompetitorId: firstFinalWinnerId };
  }
  if (firstFinalWinnerId !== losersBracketCompetitorId) {
    throw new Error("Grand-final winner is not a finalist");
  }
  if (resetFinalWinnerId === null) return { kind: "reset_required" };
  if (
    resetFinalWinnerId !== winnersBracketCompetitorId &&
    resetFinalWinnerId !== losersBracketCompetitorId
  ) {
    throw new Error("Grand-final reset winner is not a finalist");
  }
  return { kind: "completed", winnerCompetitorId: resetFinalWinnerId };
}

export type RoundRobinSeriesResult = {
  firstCompetitorId: string;
  secondCompetitorId: string;
  winnerCompetitorId: string;
  firstGameWins: number;
  secondGameWins: number;
};

export type RoundRobinRank = {
  competitorId: string;
  seriesWins: number;
  gameDifferential: number;
  rank: number | null;
  needsTiebreak: boolean;
};

type RoundRobinBase = Omit<RoundRobinRank, "rank" | "needsTiebreak">;

function baseStanding(
  competitorId: string,
  results: readonly RoundRobinSeriesResult[],
): RoundRobinBase {
  const relevant = results.filter(
    (result) =>
      result.firstCompetitorId === competitorId ||
      result.secondCompetitorId === competitorId,
  );
  return {
    competitorId,
    seriesWins: relevant.filter(
      (result) => result.winnerCompetitorId === competitorId,
    ).length,
    gameDifferential: relevant.reduce((total, result) => {
      const isFirst = result.firstCompetitorId === competitorId;
      const own = isFirst ? result.firstGameWins : result.secondGameWins;
      const opponent = isFirst ? result.secondGameWins : result.firstGameWins;
      return total + own - opponent;
    }, 0),
  };
}

function twoWayHeadToHead(
  group: readonly RoundRobinBase[],
  results: readonly RoundRobinSeriesResult[],
  nextRank: number,
): RoundRobinRank[] | null {
  const [first, second] = group;
  if (first === undefined || second === undefined || group.length !== 2) {
    return null;
  }
  const headToHead = results.find(
    (result) =>
      (result.firstCompetitorId === first.competitorId &&
        result.secondCompetitorId === second.competitorId) ||
      (result.firstCompetitorId === second.competitorId &&
        result.secondCompetitorId === first.competitorId),
  );
  if (headToHead === undefined) return null;
  const winner =
    headToHead.winnerCompetitorId === first.competitorId ? first : second;
  const loser = winner === first ? second : first;
  return [
    { ...winner, rank: nextRank, needsTiebreak: false },
    { ...loser, rank: nextRank + 1, needsTiebreak: false },
  ];
}

function rankByDifferential(
  group: readonly RoundRobinBase[],
  nextRank: number,
): RoundRobinRank[] {
  const ordered = group.toSorted(
    (left, right) =>
      right.gameDifferential - left.gameDifferential ||
      left.competitorId.localeCompare(right.competitorId),
  );
  const differentialGroups = Map.groupBy(
    ordered,
    (standing) => standing.gameDifferential,
  );
  return ordered.map((standing, index) => {
    const tied = differentialGroups.get(standing.gameDifferential) ?? [];
    return {
      ...standing,
      rank: tied.length === 1 ? nextRank + index : null,
      needsTiebreak: tied.length > 1,
    };
  });
}

export function rankRoundRobin(
  competitorIds: readonly string[],
  results: readonly RoundRobinSeriesResult[],
): RoundRobinRank[] {
  if (competitorIds.length < 2 || competitorIds.length > 16) {
    throw new Error("Round-robin events require between 2 and 16 entrants");
  }
  const base = competitorIds.map((competitorId) =>
    baseStanding(competitorId, results),
  );
  const groups = [
    ...Map.groupBy(base, (standing) => standing.seriesWins).entries(),
  ].toSorted(([leftWins], [rightWins]) => rightWins - leftWins);
  const ranked: RoundRobinRank[] = [];
  let nextRank = 1;
  for (const [, group] of groups) {
    const ordered =
      twoWayHeadToHead(group, results, nextRank) ??
      rankByDifferential(group, nextRank);
    ranked.push(...ordered);
    nextRank += group.length;
  }
  return ranked;
}

export function buildDuelStanding(input: {
  competitorId: string;
  gameWins: number;
  gameLosses: number;
  seriesWins: number;
  seriesLosses: number;
  streak: number;
}): DuelStanding {
  const games = input.gameWins + input.gameLosses;
  const series = input.seriesWins + input.seriesLosses;
  return DuelStandingSchema.parse({
    competitorId: input.competitorId,
    games,
    series,
    wins: input.gameWins,
    losses: input.gameLosses,
    seriesWins: input.seriesWins,
    seriesLosses: input.seriesLosses,
    gameDifferential: input.gameWins - input.gameLosses,
    winRate: games === 0 ? null : input.gameWins / games,
    placed: games >= 5,
    streak: input.streak,
  });
}
