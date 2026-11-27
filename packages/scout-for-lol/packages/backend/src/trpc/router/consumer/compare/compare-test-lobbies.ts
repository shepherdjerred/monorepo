import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { LeaguePuuid } from "@scout-for-lol/data";
import { testPuuid } from "#src/testing/test-ids.ts";
import type { TestLakeMatchFact } from "#src/testing/report-lake/rows.ts";

/** Lake fixtures for the Compare endpoint's tests. */

let lastMatchNumber = 9_700_000_000;
function nextMatchId(): RiotMatchId {
  lastMatchNumber += 1;
  return RiotMatchIdSchema.parse(`NA1_${lastMatchNumber.toString()}`);
}

export type Seat = {
  player: { id: number; alias: string };
  puuid: LeaguePuuid;
  team: 100 | 200;
  championId?: number;
  championName?: string;
};

/**
 * A standard 5v5 with the tracked players on their stated teams and strangers
 * filling every other seat. `winner` is the winning team.
 */
export function lobby(options: {
  at: Date;
  winner: 100 | 200;
  seats: Seat[];
  queue?: string;
}): { tracked: TestLakeMatchFact[]; strangers: TestLakeMatchFact[] } {
  const matchId = nextMatchId();
  const queue = options.queue ?? "solo";
  const tracked = options.seats.map((seat): TestLakeMatchFact => ({
    playerId: seat.player.id,
    playerAlias: seat.player.alias,
    matchId,
    puuid: seat.puuid,
    queue,
    win: seat.team === options.winner,
    surrendered: false,
    kills: 5,
    deaths: 2,
    assists: 7,
    teamId: seat.team,
    championId: seat.championId ?? 103,
    championName: seat.championName ?? "Ahri",
    gameCreationAt: options.at,
  }));
  const strangers: TestLakeMatchFact[] = [];
  for (const team of [100, 200] as const) {
    const filled = options.seats.filter((seat) => seat.team === team).length;
    for (let index = 0; index < 5 - filled; index += 1) {
      strangers.push({
        playerId: 9000 + (team === 100 ? 0 : 5) + index,
        playerAlias: `Stranger ${team.toString()}-${index.toString()}`,
        matchId,
        puuid: testPuuid(
          `stranger-${matchId}-${team.toString()}-${index.toString()}`,
        ),
        queue,
        win: team === options.winner,
        surrendered: false,
        kills: 3,
        deaths: 3,
        assists: 3,
        teamId: team,
        gameCreationAt: options.at,
      });
    }
  }
  return { tracked, strangers };
}

export function soloGame(options: {
  seat: Seat;
  win: boolean;
  at: Date;
  championId: number;
  championName: string;
}): TestLakeMatchFact {
  return {
    playerId: options.seat.player.id,
    playerAlias: options.seat.player.alias,
    matchId: nextMatchId(),
    puuid: options.seat.puuid,
    queue: "solo",
    win: options.win,
    surrendered: false,
    kills: 5,
    deaths: 2,
    assists: 7,
    championId: options.championId,
    championName: options.championName,
    gameCreationAt: options.at,
  };
}
