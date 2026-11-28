import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { LaneResultReadRow } from "#src/report-lake/lane-results/lane-result-columns.ts";
import {
  addAheadAt15,
  emptyAheadAt15,
  type AheadAt15,
  type LaneStanding,
} from "#src/reports/lanes/ahead-at-15.ts";
import type { ChampionPagePerson } from "#src/trpc/router/consumer/consumer-champion-people.ts";

/** The newest viewer games the page lists. */
export const MATCHUP_RECENT_GAMES = 10;

/** A record in the matchup, with the game count every figure rests on. */
export type MatchupTally = {
  games: number;
  wins: number;
  ahead15: AheadAt15;
};

export type MatchupRecentGame = {
  matchId: RiotMatchId;
  win: boolean;
  playedAtMs: number;
  kills: number;
  deaths: number;
  assists: number;
  /** `null` when the game has no 15:00 checkpoint. */
  at15: LaneStanding | null;
  /** `null` where no ranked change is recorded. */
  lpDelta: number | null;
};

/** One person's game in the matchup, counted once however many accounts they have. */
export type MatchupGame = { isViewer: boolean; row: LaneResultReadRow };

/**
 * Attribute lane rows to people. A person's accounts are one person, so a game
 * two of their accounts were both in counts once; a row for an account nobody
 * on the page owns is a broken contract, not data to skip.
 */
export function attributeMatchupGames(
  rows: readonly LaneResultReadRow[],
  people: readonly ChampionPagePerson[],
): MatchupGame[] {
  const personByPuuid = new Map<string, ChampionPagePerson>(
    people.flatMap((person) =>
      person.puuids.map((puuid) => [puuid, person] as const),
    ),
  );
  const seen = new Set<string>();
  const games: MatchupGame[] = [];
  for (const row of rows) {
    const person =
      row.puuid === null ? undefined : personByPuuid.get(row.puuid);
    if (person === undefined) {
      throw new Error("Champion matchup returned an unrequested player");
    }
    const key = `${person.playerId.toString()}:${row.match_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    games.push({ isViewer: person.isViewer, row });
  }
  return games;
}

export function tallyMatchupGames(games: readonly MatchupGame[]): MatchupTally {
  const tally: MatchupTally = {
    games: 0,
    wins: 0,
    ahead15: emptyAheadAt15(),
  };
  for (const { row } of games) {
    tally.games += 1;
    if (row.win) tally.wins += 1;
    addAheadAt15(tally.ahead15, row);
  }
  return tally;
}
