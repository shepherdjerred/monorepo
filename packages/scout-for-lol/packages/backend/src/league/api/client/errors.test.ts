import { describe, expect, test } from "vitest";
import {
  endpointTemplate,
  EXPECTED_UPSTREAM_STATUS_CODES,
  extractHttpStatus,
  isExpectedUpstreamError,
  RiotHttpError,
  riotSourceAbsence,
} from "./errors.ts";

function riotError(status: number): RiotHttpError {
  return new RiotHttpError({
    status,
    statusText: "Upstream error",
    body: undefined,
    url: "https://na1.api.riotgames.com/test",
    headers: new Headers(),
  });
}

describe("isExpectedUpstreamError", () => {
  test("treats reviewed Riot origin and Cloudflare failures as expected", () => {
    for (const status of [502, 503, 504, 520, 522, 524]) {
      expect(isExpectedUpstreamError(status)).toBe(true);
    }
  });

  test("keeps other client, origin, and Cloudflare failures visible", () => {
    for (const status of [
      200, 400, 404, 429, 500, 501, 521, 523, 525, 526, 527, 528, 529, 530,
    ]) {
      expect(isExpectedUpstreamError(status)).toBe(false);
    }
    expect(isExpectedUpstreamError(undefined)).toBe(false);
  });
});

describe("extractHttpStatus", () => {
  test("reads the status from RiotHttpError", () => {
    expect(extractHttpStatus(riotError(520))).toBe(520);
  });

  test("does not classify similarly shaped third-party errors", () => {
    expect(extractHttpStatus({ status: 520 })).toBeUndefined();
    expect(extractHttpStatus({ status: "520" })).toBeUndefined();
    expect(extractHttpStatus(new Error("boom"))).toBeUndefined();
    expect(extractHttpStatus(undefined)).toBeUndefined();
  });

  test("a Riot Cloudflare 520 flows into the expected-error policy", () => {
    const status = extractHttpStatus(riotError(520));
    expect(status).toBe(520);
    expect(isExpectedUpstreamError(status)).toBe(true);
    expect(EXPECTED_UPSTREAM_STATUS_CODES.has(520)).toBe(true);
  });
});

describe("riotSourceAbsence", () => {
  test("classifies Riot's definitive refusals", () => {
    expect(riotSourceAbsence(riotError(403))).toBe("forbidden");
    expect(riotSourceAbsence(riotError(404))).toBe("not_found");
  });

  test("outages, rate limits, and foreign errors are not absence", () => {
    for (const status of [401, 429, 500, 503]) {
      expect(riotSourceAbsence(riotError(status))).toBeUndefined();
    }
    expect(
      riotSourceAbsence(Object.assign(new Error("Forbidden"), { status: 403 })),
    ).toBeUndefined();
  });
});

describe("endpointTemplate", () => {
  test.each([
    [
      "https://americas.api.riotgames.com/lol/match/v5/matches/NA1_5012345678",
      "americas.api.riotgames.com/lol/match/v5/matches/{matchId}",
    ],
    [
      "https://sea.api.riotgames.com/lol/match/v5/matches/OC1_123/timeline",
      "sea.api.riotgames.com/lol/match/v5/matches/{matchId}/timeline",
    ],
    [
      "https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/abc-DEF_1/ids?start=0&count=20",
      "americas.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids",
    ],
    [
      "https://americas.api.riotgames.com/riot/account/v1/accounts/by-puuid/abc",
      "americas.api.riotgames.com/riot/account/v1/accounts/by-puuid/{puuid}",
    ],
    [
      "https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/Some%20Name/EUW",
      "europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}",
    ],
    [
      "https://na1.api.riotgames.com/lol/league/v4/entries/by-puuid/abc",
      "na1.api.riotgames.com/lol/league/v4/entries/by-puuid/{puuid}",
    ],
    [
      "https://na1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/abc/top?count=3",
      "na1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}/top",
    ],
    [
      "https://na1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/abc",
      "na1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/{puuid}",
    ],
    [
      "https://na1.api.riotgames.com/lol/clash/v1/tournaments",
      "na1.api.riotgames.com/lol/clash/v1/tournaments",
    ],
    [
      "https://na1.api.riotgames.com/lol/clash/v1/players/by-puuid/abc",
      "na1.api.riotgames.com/lol/clash/v1/players/by-puuid/{puuid}",
    ],
    [
      "https://na1.api.riotgames.com/lol/clash/v1/teams/team-1",
      "na1.api.riotgames.com/lol/clash/v1/teams/{teamId}",
    ],
  ])("%s", (url, template) => {
    expect(endpointTemplate(url)).toBe(template);
  });

  test("keeps a bare test label without its query string", () => {
    expect(endpointTemplate("match-evidence?x=1")).toBe("match-evidence");
  });
});
