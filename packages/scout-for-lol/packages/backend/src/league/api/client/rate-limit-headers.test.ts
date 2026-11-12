import { describe, expect, test } from "vitest";
import {
  methodKeyOfUrl,
  parseAppRateLimitWindows,
  parseMethodRateLimitWindows,
  parseRateLimitType,
  routeOfUrl,
} from "./rate-limit-headers.ts";

describe("parseAppRateLimitWindows", () => {
  test("parses a multi-window header and zips by window, not position", () => {
    const headers = new Headers({
      "X-App-Rate-Limit": "20:1,100:120",
      // Deliberately listed in a different order than the limit header.
      "X-App-Rate-Limit-Count": "45:120,3:1",
    });

    expect(parseAppRateLimitWindows(headers)).toEqual([
      { windowSeconds: 1, count: 3, limit: 20 },
      { windowSeconds: 120, count: 45, limit: 100 },
    ]);
  });

  test("parses a single-window header", () => {
    const headers = new Headers({
      "X-App-Rate-Limit": "20:1",
      "X-App-Rate-Limit-Count": "5:1",
    });

    expect(parseAppRateLimitWindows(headers)).toEqual([
      { windowSeconds: 1, count: 5, limit: 20 },
    ]);
  });

  test("skips malformed/non-numeric entries instead of throwing", () => {
    const headers = new Headers({
      "X-App-Rate-Limit": "20:1,abc:xyz,100:120",
      "X-App-Rate-Limit-Count": "3:1,45:120",
    });

    expect(() => parseAppRateLimitWindows(headers)).not.toThrow();
    expect(parseAppRateLimitWindows(headers)).toEqual([
      { windowSeconds: 1, count: 3, limit: 20 },
      { windowSeconds: 120, count: 45, limit: 100 },
    ]);
  });

  test("returns an empty array when either header is missing", () => {
    const onlyLimit = new Headers({ "X-App-Rate-Limit": "20:1" });
    const onlyCount = new Headers({ "X-App-Rate-Limit-Count": "5:1" });
    const neither = new Headers();

    expect(parseAppRateLimitWindows(onlyLimit)).toEqual([]);
    expect(parseAppRateLimitWindows(onlyCount)).toEqual([]);
    expect(parseAppRateLimitWindows(neither)).toEqual([]);
  });

  test("drops unmatched windows present in only one header", () => {
    const headers = new Headers({
      "X-App-Rate-Limit": "20:1,100:120,500:600",
      "X-App-Rate-Limit-Count": "3:1,45:120,9:10",
    });

    expect(parseAppRateLimitWindows(headers)).toEqual([
      { windowSeconds: 1, count: 3, limit: 20 },
      { windowSeconds: 120, count: 45, limit: 100 },
    ]);
  });
});

describe("parseMethodRateLimitWindows", () => {
  test("parses real Riot method headers", () => {
    const headers = new Headers({
      "X-Method-Rate-Limit": "2000:10",
      "X-Method-Rate-Limit-Count": "7:10",
      "X-App-Rate-Limit": "20:1,100:120",
      "X-App-Rate-Limit-Count": "1:1,1:120",
    });
    expect(parseMethodRateLimitWindows(headers)).toEqual([
      { windowSeconds: 10, count: 7, limit: 2000 },
    ]);
  });

  test("returns empty when headers are absent or malformed", () => {
    expect(parseMethodRateLimitWindows(new Headers())).toEqual([]);
    expect(
      parseMethodRateLimitWindows(
        new Headers({
          "X-Method-Rate-Limit": "abc",
          "X-Method-Rate-Limit-Count": "1:10",
        }),
      ),
    ).toEqual([]);
  });
});

describe("parseRateLimitType", () => {
  test.each(["application", "method", "service"] as const)("%s", (type) => {
    expect(parseRateLimitType(new Headers({ "X-Rate-Limit-Type": type }))).toBe(
      type,
    );
  });

  test("unknown when absent or unrecognised", () => {
    expect(parseRateLimitType(new Headers())).toBe("unknown");
    expect(parseRateLimitType(new Headers({ "X-Rate-Limit-Type": "x" }))).toBe(
      "unknown",
    );
  });
});

describe("routeOfUrl", () => {
  test("extracts regional and platform routes", () => {
    expect(
      routeOfUrl("https://americas.api.riotgames.com/lol/match/v5/matches/X"),
    ).toBe("americas");
    expect(
      routeOfUrl("https://na1.api.riotgames.com/lol/clash/v1/tournaments"),
    ).toBe("na1");
  });

  test("other for non-Riot or invalid URLs", () => {
    expect(routeOfUrl("https://example.test/x")).toBe("other");
    expect(routeOfUrl("not a url")).toBe("other");
  });
});

describe("methodKeyOfUrl", () => {
  const base = "https://americas.api.riotgames.com";
  test("templates ids and drops query strings", () => {
    expect(methodKeyOfUrl(`${base}/lol/match/v5/matches/NA1_123`)).toBe(
      "/lol/match/v5/matches/{matchId}",
    );
    expect(
      methodKeyOfUrl(`${base}/lol/match/v5/matches/NA1_123/timeline`),
    ).toBe("/lol/match/v5/matches/{matchId}/timeline");
    expect(
      methodKeyOfUrl(`${base}/lol/match/v5/matches/by-puuid/abc/ids?start=0`),
    ).toBe("/lol/match/v5/matches/by-puuid/{puuid}/ids");
    expect(
      methodKeyOfUrl(`${base}/riot/account/v1/accounts/by-riot-id/Foo/NA1`),
    ).toBe("/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}");
    expect(
      methodKeyOfUrl(
        "https://na1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/abc/top?count=3",
      ),
    ).toBe("/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}/top");
  });

  test("unknown paths collapse to other", () => {
    expect(methodKeyOfUrl(`${base}/lol/new/v9/thing/abc`)).toBe("other");
    expect(methodKeyOfUrl("garbage")).toBe("other");
  });
});
