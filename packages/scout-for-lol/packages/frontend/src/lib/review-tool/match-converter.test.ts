import { describe, expect, test } from "bun:test";
import { RawMatchSchema } from "@scout-for-lol/data";
import { convertRawMatchToInternalFormat } from "./match-converter.ts";

describe("convertRawMatchToInternalFormat", () => {
  test("rejects League Classic matches that the review tool cannot represent", () => {
    const rawMatch = RawMatchSchema.parse({
      metadata: {
        dataVersion: "2",
        matchId: "NA1_1234567890",
        participants: [],
      },
      info: {
        endOfGameResult: "GameComplete",
        gameCreation: 0,
        gameDuration: 1800,
        gameEndTimestamp: 1800,
        gameId: 1_234_567_890,
        gameMode: "JADE",
        gameName: "League Classic test",
        gameStartTimestamp: 0,
        gameType: "MATCHED_GAME",
        gameVersion: "16.15.1",
        mapId: 453,
        participants: [],
        platformId: "NA1",
        queueId: 4310,
        teams: [],
        tournamentCode: "",
      },
    });

    expect(() => convertRawMatchToInternalFormat(rawMatch)).toThrow(
      "League Classic matches are not supported by the review tool",
    );
  });
});
