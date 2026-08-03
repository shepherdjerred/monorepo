import { S3Client } from "@aws-sdk/client-s3";
import { RawMatchSchema, RawTimelineSchema } from "@scout-for-lol/data";
import { describe, expect, test } from "bun:test";

import { fetchRawMatchPair } from "#materialization/s3-source.ts";

describe("fetchRawMatchPair", () => {
  test("rejects independently valid objects with different match IDs", async () => {
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
        gameMode: "CLASSIC",
        gameName: "test",
        gameStartTimestamp: 0,
        gameType: "MATCHED_GAME",
        gameVersion: "14.1.1",
        mapId: 11,
        participants: [],
        platformId: "NA1",
        queueId: 420,
        teams: [],
        tournamentCode: "",
      },
    });
    const rawTimeline = RawTimelineSchema.parse({
      metadata: {
        dataVersion: "2",
        matchId: "NA1_9876543210",
        participants: [],
      },
      info: {
        frameInterval: 60_000,
        frames: [],
        gameId: 9_876_543_210,
        participants: [],
      },
    });
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/test-bucket/match.json") {
          return Response.json(rawMatch);
        }
        if (pathname === "/test-bucket/timeline.json") {
          return Response.json(rawTimeline);
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const client = new S3Client({
      credentials: {
        accessKeyId: "test",
        secretAccessKey: "test",
      },
      endpoint: server.url.origin,
      forcePathStyle: true,
      region: "us-east-1",
    });

    try {
      await expect(
        fetchRawMatchPair(client, "test-bucket", "match.json", "timeline.json"),
      ).rejects.toThrow(
        "Raw match/timeline matchId mismatch: match NA1_1234567890, timeline NA1_9876543210",
      );
    } finally {
      client.destroy();
      await server.stop();
    }
  });
});
