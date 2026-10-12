import { describe, expect, test } from "vitest";
import { observedLobbyBots } from "#src/scout-client/lobby-payload.ts";

/**
 * Shapes taken from a live `/lol-lobby/v2/lobby` read during a 1-human,
 * 9-bot custom. Trimmed to the fields the parser looks at, with the real
 * values for each: a bot reports `isBot`, a champion and a position, and a
 * human reports the same keys zeroed out.
 */
function bot(championId: number, position: string): unknown {
  return {
    isBot: true,
    botChampionId: championId,
    botDifficulty: "RSINTERMEDIATE",
    botPosition: position,
    puuid: "",
    summonerName: "",
    teamId: 0,
  };
}

const human = {
  isBot: false,
  botChampionId: 0,
  botDifficulty: "NONE",
  botPosition: "NONE",
  puuid: "a-real-puuid",
  summonerName: "sjerred",
  teamId: 0,
};

function lobby(
  customTeam100: readonly unknown[],
  customTeam200: readonly unknown[],
): unknown {
  return {
    resource: "lobby",
    data: {
      partyId: "e5028813-c00d-4a6d-add9-38c86304fca2",
      gameConfig: { customTeam100, customTeam200 },
    },
  };
}

describe("observedLobbyBots", () => {
  test("recovers the bots Riot's spectator roster omits", () => {
    const observed = observedLobbyBots(
      lobby(
        [human, bot(875, "TOP"), bot(201, "JUNGLE")],
        [bot(42, "MIDDLE"), bot(96, "BOTTOM"), bot(22, "UTILITY")],
      ),
    );

    expect(observed).toEqual([
      { side: "blue", championId: 875, lane: "top" },
      { side: "blue", championId: 201, lane: "jungle" },
      { side: "red", championId: 42, lane: "middle" },
      { side: "red", championId: 96, lane: "adc" },
      { side: "red", championId: 22, lane: "support" },
    ]);
  });

  test("takes the side from the array, not from teamId", () => {
    // Every slot in a custom lobby reports `teamId: 0`, on both sides. Reading
    // it would put the whole lobby on blue.
    const observed = observedLobbyBots(lobby([], [bot(42, "MIDDLE")]));

    expect(observed).toEqual([{ side: "red", championId: 42, lane: "middle" }]);
  });

  test("skips a human, whose champion the lobby does not know", () => {
    // The lobby predates champion select, so a human slot carries no pick.
    // They are knowable only from the Spectator roster, which reports them.
    expect(observedLobbyBots(lobby([human], []))).toEqual([]);
  });

  test("keeps a bot whose position is not a standard lane", () => {
    const observed = observedLobbyBots(lobby([bot(875, "NONE")], []));

    expect(observed).toEqual([
      { side: "blue", championId: 875, lane: undefined },
    ]);
  });

  test("reports nothing for a lobby that is not a custom", () => {
    expect(
      observedLobbyBots({ resource: "lobby", data: { partyId: "p" } }),
    ).toEqual([]);
    expect(observedLobbyBots(undefined)).toEqual([]);
  });
});
