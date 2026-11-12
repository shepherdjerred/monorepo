import { describe, expect, it } from "vitest";
import {
  AccountIdSchema,
  ChampionIdSchema,
  LeaguePuuidSchema,
  PlayerIdSchema,
  type CompetitionCriteria,
  type CompetitionGameVariant,
  type EndOfGameMatch,
} from "@scout-for-lol/data";
import { processCriteria } from "#src/league/competition/processors/index.ts";
import type { PlayerWithAccounts } from "#src/league/competition/processors/types.ts";
import { classicEndOfGameMatch } from "#src/testing/scout-client/end-of-game-fixtures.ts";

/**
 * A League Classic game Scout knows only from the end-of-game block scores
 * like any other: competitions read participant stats, queue and win, all of
 * which the block states.
 */
function trackedPlayer(match: EndOfGameMatch, index: number) {
  const participant = match.info.participants[index];
  if (participant === undefined) throw new Error("The fixture has players");
  const player: PlayerWithAccounts = {
    id: PlayerIdSchema.parse(index + 1),
    alias: participant.riotIdGameName ?? `Player${(index + 1).toString()}`,
    discordId: null,
    accounts: [
      {
        id: AccountIdSchema.parse(index + 1),
        alias: `Account${(index + 1).toString()}`,
        puuid: LeaguePuuidSchema.parse(participant.puuid),
        region: "AMERICA_NORTH",
      },
    ],
  };
  return { player, championId: ChampionIdSchema.parse(participant.championId) };
}

/** The fixture's record, one tracked winner and one tracked loser, and a scorer. */
async function scenario() {
  const match = await classicEndOfGameMatch();
  const won = trackedPlayer(
    match,
    match.info.participants.findIndex((p) => p.win),
  );
  const lost = trackedPlayer(
    match,
    match.info.participants.findIndex((p) => !p.win),
  );
  function score(
    criteria: CompetitionCriteria,
    variant: CompetitionGameVariant = "CLASSIC",
  ) {
    const entries = processCriteria(
      criteria,
      [match],
      [won.player, lost.player],
      undefined,
      variant,
    );
    return {
      won: entries.find((entry) => entry.playerId === won.player.id)?.score,
      lost: entries.find((entry) => entry.playerId === lost.player.id)?.score,
    };
  }
  return { won, score };
}

describe("competition processors on an end-of-game record", () => {
  it("counts the game for every tracked participant", async () => {
    const { score } = await scenario();

    expect(score({ type: "MOST_GAMES_PLAYED", queues: ["classic"] })).toEqual({
      won: 1,
      lost: 1,
    });
  });

  it("counts the game under the ALL queue filter of the Classic variant", async () => {
    const { score } = await scenario();

    expect(score({ type: "MOST_GAMES_PLAYED", queues: ["ALL"] })).toEqual({
      won: 1,
      lost: 1,
    });
  });

  it("scores wins from the stated result", async () => {
    const { score } = await scenario();

    expect(score({ type: "MOST_WINS_PLAYER", queues: ["classic"] })).toEqual({
      won: 1,
      lost: 0,
    });
  });

  it("scores champion wins from the stated champion", async () => {
    const { score, won } = await scenario();

    expect(
      score({
        type: "MOST_WINS_CHAMPION",
        queues: ["classic"],
        championId: won.championId,
      }),
    ).toEqual({ won: 1, lost: 0 });
  });

  it("scores win rate from the stated results", async () => {
    const { score } = await scenario();

    expect(
      score({ type: "HIGHEST_WIN_RATE", queues: ["classic"], minGames: 1 }),
    ).toEqual({ won: 1, lost: 0 });
  });

  it("leaves the game out of a queue it is not in", async () => {
    const { score } = await scenario();

    expect(
      score({ type: "MOST_GAMES_PLAYED", queues: ["solo"] }, "MODERN"),
    ).toEqual({ won: 0, lost: 0 });
  });
});
