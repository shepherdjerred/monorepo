import { expect, test, vi } from "vitest";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import { RiotClient, type FetchFunction } from "./riot-client.ts";

const apiKey = "RGAPI-test-api-key";
const testPuuid = LeaguePuuidSchema.parse(
  "00000000-0000-0000-0000-000000000000000000000000000000000000000000000000000000",
);

test("fetches the complete champion-mastery list on the platform host", async () => {
  let capturedUrl = "";
  const mockFetch: FetchFunction = vi.fn(
    async (input: string | URL | Request): Promise<Response> => {
      capturedUrl =
        typeof input === "string"
          ? input
          : "url" in input
            ? input.url
            : input.href;
      return Response.json([
        {
          puuid: testPuuid,
          championId: 103,
          championLevel: 7,
          championPoints: 123_456,
          lastPlayTime: 1_700_000_000_000,
          championPointsSinceLastLevel: 101_856,
          championPointsUntilNextLevel: 0,
          chestGranted: true,
          tokensEarned: 2,
        },
      ]);
    },
  );
  const client = new RiotClient({ apiKey, fetchFn: mockFetch });
  const result = await client.championMastery.byPuuid(testPuuid, "NA1");

  expect(capturedUrl).toBe(
    `https://na1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${testPuuid}`,
  );
  expect(result).toHaveLength(1);
});
