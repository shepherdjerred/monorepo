import { describe, expect, test } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/data";
import { parseEndOfGameResult } from "./end-of-game-result.ts";
import fixture from "./testdata/classic-end-of-game.json";

const observer = "scoreboard-observer".padEnd(78, "x");
const matchId = RiotMatchIdSchema.parse("NA1_123456789");
export const context = {
  gameData: {
    gameId: 123_456_789,
    queue: { id: 4310, type: "JADE_RANKED_SOLO_5x5", gameMode: "JADE" },
  },
};
function parse(payload: unknown = fixture, gameflow: unknown = context) {
  return parseEndOfGameResult({
    matchId,
    payload,
    context: gameflow,
    observer,
    sourceId: "terminal-scoreboard",
  });
}

describe("terminal scoreboard evidence", () => {
  test("normalizes the real Classic terminal shape without inventing history or participant numbers", () => {
    const result = parse();
    expect(result).toMatchObject({
      matchId,
      queueId: 4310,
      gameMode: "JADE",
      gameCreation: null,
      completedAt: 1_792_296_413_231,
      durationSeconds: 2213,
    });
    expect(result?.participants).toHaveLength(10);
    expect(
      result?.participants.every((player) => player.participantId === null),
    ).toBe(true);
    expect(
      result?.participants.find((player) => player.identity.kind === "riot")
        ?.identity,
    ).toEqual({ kind: "riot", puuid: observer });
    expect(result).not.toHaveProperty("objectives");
  });
  test.each(["context-game", "context-mode"])(
    "rejects mismatched metadata: %s",
    (change) => {
      const gameflow = structuredClone(context);
      if (change === "context-game") gameflow.gameData.gameId = 99;
      else gameflow.gameData.queue.gameMode = "CLASSIC";
      expect(parse(fixture, gameflow)).toBeNull();
    },
  );
  test.each(["player-game", "outcome", "missing-stat"])(
    "rejects unverified player facts: %s",
    (change) => {
      const payload = structuredClone(fixture);
      const gameflow = structuredClone(context);
      const player = payload.data.teams[0]?.players[0];
      if (player === undefined) throw new Error("Fixture requires players");
      if (change === "player-game") player.gameId = 99;
      if (change === "outcome")
        player.stats.WIN = player.stats.WIN === 1 ? 0 : 1;
      if (change === "missing-stat")
        Reflect.deleteProperty(player.stats, "goldEarned");
      expect(parse(payload, gameflow)).toBeNull();
    },
  );
  test.each(["00000000-0000-0000-0000-000000000000", ""])(
    "accepts several bots sharing the bot puuid %j",
    (botPuuid) => {
      // A Co-op vs AI or bot custom fields up to nine bots, all one identity.
      const payload = structuredClone(fixture);
      const enemies = payload.data.teams.find((team) => team.teamId === 100);
      if (enemies === undefined) throw new Error("Fixture requires team 100");
      for (const player of enemies.players) {
        player.puuid = botPuuid;
        player.botPlayer = true;
      }
      const result = parse(payload);

      expect(result?.participants).toHaveLength(10);
      expect(
        result?.participants.filter((player) => player.identity.kind === "bot"),
      ).toHaveLength(5);
      expect(
        result?.participants.find((player) => player.identity.kind === "riot")
          ?.identity,
      ).toEqual({ kind: "riot", puuid: observer });
    },
  );
  test("still refuses two players sharing one identity", () => {
    const payload = structuredClone(fixture);
    const [first, second] = payload.data.teams[1]?.players ?? [];
    if (first === undefined || second === undefined)
      throw new Error("Fixture requires two players on a team");
    second.puuid = first.puuid;
    expect(parse(payload)).toBeNull();
  });
  test("an unaliased player is named by League-client UUID, never as Riot", () => {
    const result = parse();
    const local = result?.participants.filter(
      (player) => player.identity.kind === "local",
    );
    expect(local).toHaveLength(9);
  });
  test("rejects a scoreboard that does not contain the authenticated observer", () => {
    const payload = structuredClone(fixture);
    const player = payload.data.teams
      .flatMap((team) => team.players)
      .find((candidate) => candidate.puuid === observer);
    if (player === undefined)
      throw new Error("Fixture must contain the observer");
    player.puuid = "other".padEnd(78, "x");
    expect(parse(payload)).toBeNull();
  });
});
