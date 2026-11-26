import { describe, expect, test } from "vitest";
import { LeaguePuuidSchema, RiotMatchIdSchema } from "@scout-for-lol/data";
import {
  RiotBudgetRefusedError,
  RiotHttpError,
} from "#src/league/api/client/errors.ts";
import { RiotBudgetLedger } from "#src/league/api/client/rate-budget.ts";
import { createCrawlRiotClient } from "./crawl-riot-client.ts";

const puuid = LeaguePuuidSchema.parse("p".repeat(78));
const matchId = RiotMatchIdSchema.parse("NA1_5312279829");

function client(respond: (url: string) => Response, refusals: unknown[] = []) {
  const urls: string[] = [];
  const api = createCrawlRiotClient({
    apiKey: "key",
    ledger: new RiotBudgetLedger({ clock: Date.now }),
    onBudgetRefusal: (refusal) => refusals.push(refusal),
    fetchFn: (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      urls.push(url);
      return Promise.resolve(respond(url));
    },
  });
  return { api, urls };
}

describe("crawl Riot client", () => {
  test("never retries: a 429 is one request and a thrown error", async () => {
    const { api, urls } = client(
      () =>
        new Response("{}", {
          status: 429,
          headers: { "retry-after": "1", "x-rate-limit-type": "application" },
        }),
    );
    await expect(api.match(matchId, "AMERICAS")).rejects.toBeInstanceOf(
      RiotHttpError,
    );
    expect(urls).toHaveLength(1);
  });

  test("never retries an upstream outage either", async () => {
    const { api, urls } = client(() => new Response("{}", { status: 503 }));
    await expect(api.timeline(matchId, "AMERICAS")).rejects.toBeInstanceOf(
      RiotHttpError,
    );
    expect(urls).toHaveLength(1);
  });

  test("reads the four crawl endpoints", async () => {
    const { api, urls } = client((url) =>
      Response.json(url.includes("/ids") ? [matchId] : []),
    );
    await api.matchIds(puuid, "AMERICAS", {
      queue: 420,
      startTime: 1_700_000_000,
      count: 20,
    });
    await api.match(matchId, "AMERICAS");
    await api.timeline(matchId, "AMERICAS");
    await api.leagueEntries(puuid, "NA1");
    expect(urls[0]).toContain("/lol/match/v5/matches/by-puuid/");
    expect(urls[0]).toContain("queue=420");
    expect(urls[1]).toContain(`/lol/match/v5/matches/${matchId}`);
    expect(urls[2]).toContain("/timeline");
    expect(urls[3]).toContain("/lol/league/v4/entries/by-puuid/");
  });

  test("tags every request as the crawl class and is refused, unsent, over its target", async () => {
    const refusals: unknown[] = [];
    // The key already spent 30 of 100 requests in the window; the crawl's
    // default target is 25. The refusal is thrown back rather than sent.
    const { api, urls } = client(
      () =>
        Response.json([], {
          headers: {
            "x-app-rate-limit": "100:120",
            "x-app-rate-limit-count": "30:120",
          },
        }),
      refusals,
    );
    await api.leagueEntries(puuid, "NA1");
    await expect(api.leagueEntries(puuid, "NA1")).rejects.toBeInstanceOf(
      RiotBudgetRefusedError,
    );
    expect(urls).toHaveLength(1);
    expect(refusals).toEqual([
      { priority: "crawl", outcome: "deferred", reason: "app-window" },
    ]);
  });
});
