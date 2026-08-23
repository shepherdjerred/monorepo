import { describe, test, expect, vi } from "vitest";
import { RiotClient, type FetchFunction } from "./riot-client.ts";
import { RiotHttpError } from "./errors.ts";
import { LeaguePuuidSchema, MatchIdSchema } from "@scout-for-lol/data";

function getUrlString(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if ("url" in input) return input.url;
  return input.href;
}

describe("RiotClient", () => {
  const apiKey = "RGAPI-test-api-key";
  const testPuuid = LeaguePuuidSchema.parse(
    "00000000-0000-0000-0000-000000000000000000000000000000000000000000000000000000",
  );
  const testMatchId = MatchIdSchema.parse("NA1_5123456789");

  test("injects X-Riot-Token header and calls correct account by PUUID endpoint", async () => {
    let capturedUrl = "";
    let capturedToken: string | null = null;

    const mockFetch: FetchFunction = vi.fn(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        capturedUrl = getUrlString(input);
        const headers = new Headers(init?.headers);
        capturedToken = headers.get("X-Riot-Token");
        return Response.json(
          {
            puuid: testPuuid,
            gameName: "Faker",
            tagLine: "KR1",
          },
          { status: 200 },
        );
      },
    );

    const client = new RiotClient({ apiKey, fetchFn: mockFetch });
    const result = await client.account.getByPuuid(testPuuid, "AMERICAS");

    expect(capturedUrl).toBe(
      `https://americas.api.riotgames.com/riot/account/v1/accounts/by-puuid/${testPuuid}`,
    );
    expect(capturedToken).toBe(apiKey);
    expect(result.gameName).toBe("Faker");
  });

  test("routes SEA account calls to ASIA regional host", async () => {
    let capturedUrl = "";
    const mockFetch: FetchFunction = vi.fn(
      async (input: string | URL | Request): Promise<Response> => {
        capturedUrl = getUrlString(input);
        return Response.json(
          {
            puuid: testPuuid,
            gameName: "SEA_Player",
            tagLine: "SG2",
          },
          { status: 200 },
        );
      },
    );

    const client = new RiotClient({ apiKey, fetchFn: mockFetch });
    await client.account.getByRiotId("SEA_Player", "SG2", "SEA");

    expect(capturedUrl).toBe(
      "https://asia.api.riotgames.com/riot/account/v1/accounts/by-riot-id/SEA_Player/SG2",
    );
  });

  test("serializes match list query parameters correctly", async () => {
    let capturedUrl = "";
    const mockFetch: FetchFunction = vi.fn(
      async (input: string | URL | Request): Promise<Response> => {
        capturedUrl = getUrlString(input);
        return Response.json(["NA1_1", "NA1_2"], { status: 200 });
      },
    );

    const client = new RiotClient({ apiKey, fetchFn: mockFetch });
    const matches = await client.match.list(testPuuid, "AMERICAS", {
      count: 10,
      start: 5,
      startTime: 1_700_000_000,
      queue: 420,
    });

    expect(matches).toEqual(["NA1_1", "NA1_2"]);
    expect(capturedUrl).toContain("count=10");
    expect(capturedUrl).toContain("start=5");
    expect(capturedUrl).toContain("startTime=1700000000");
    expect(capturedUrl).toContain("queue=420");
  });

  test("calls spectator active game endpoint on platform host", async () => {
    let capturedUrl = "";
    const mockFetch: FetchFunction = vi.fn(
      async (input: string | URL | Request): Promise<Response> => {
        capturedUrl = getUrlString(input);
        return Response.json(
          { gameId: 123_456, participants: [] },
          { status: 200 },
        );
      },
    );

    const client = new RiotClient({ apiKey, fetchFn: mockFetch });
    const result = await client.spectator.activeGame(testPuuid, "NA1");

    expect(capturedUrl).toBe(
      `https://na1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${testPuuid}`,
    );
    expect(result).toEqual({ gameId: 123_456, participants: [] });
  });

  test("throws typed RiotHttpError on 404 without retrying", async () => {
    let callCount = 0;
    const mockFetch: FetchFunction = vi.fn(async (): Promise<Response> => {
      callCount += 1;
      return Response.json(
        { status: { message: "Not Found", status_code: 404 } },
        {
          status: 404,
          statusText: "Not Found",
          headers: {
            "X-Riot-Edge-Trace-Id": "trace-12345",
          },
        },
      );
    });

    const client = new RiotClient({
      apiKey,
      fetchFn: mockFetch,
      maxRetries: 3,
    });

    await expect(client.match.get(testMatchId, "AMERICAS")).rejects.toThrow(
      RiotHttpError,
    );
    expect(callCount).toBe(1); // 404 should never be retried
  });

  test("retries on 429 rate limit using Retry-After header", async () => {
    let callCount = 0;
    const mockFetch: FetchFunction = vi.fn(async (): Promise<Response> => {
      callCount += 1;
      if (callCount === 1) {
        return Response.json(
          { message: "Rate limit exceeded" },
          {
            status: 429,
            statusText: "Too Many Requests",
            headers: {
              "Retry-After": "0",
            },
          },
        );
      }
      return Response.json({ matchId: testMatchId }, { status: 200 });
    });

    const client = new RiotClient({
      apiKey,
      fetchFn: mockFetch,
      maxRetries: 3,
    });
    const result = await client.match.get(testMatchId, "AMERICAS");

    expect(callCount).toBe(2);
    expect(result).toEqual({ matchId: testMatchId });
  });
});
