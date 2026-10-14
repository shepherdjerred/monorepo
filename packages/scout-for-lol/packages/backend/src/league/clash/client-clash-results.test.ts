import { expect, test } from "vitest";
import {
  enrichClashTeamResults,
  type ClashResultEvidence,
} from "#src/evidence/clash-results.ts";
import type { ClientClashTeam } from "./client-clash-types.ts";

const team: ClientClashTeam = {
  platformId: "NA1",
  rosterId: "own",
  tournamentId: "101",
  name: "Team",
  abbreviation: "T",
  tier: null,
  memberPuuids: ["owner", "teammate"],
  capturedAt: new Date(),
  matches: [
    {
      round: 1,
      opponent: { kind: "unknown" },
      result: "pending",
      status: null,
      gameIds: ["123"],
    },
  ],
};
const result: ClashResultEvidence = {
  platform: "NA1",
  gameId: "123",
  puuid: "owner",
  teamId: 100,
  win: true,
  resultSource: "SCOUT_CLIENT",
  resultConflict: false,
};

test("a completed game can enrich a bracket without a published winner", () => {
  expect(enrichClashTeamResults(team, [result]).matches[0]?.result).toBe("won");
  expect(
    enrichClashTeamResults(team, [{ ...result, platform: "EUW1" }]).matches[0]
      ?.result,
  ).toBe("pending");
  expect(
    enrichClashTeamResults(team, [{ ...result, puuid: "opponent" }]).matches[0]
      ?.result,
  ).toBe("pending");
});

test("Riot wins overlaps and contradictory client outcomes remain unresolved", () => {
  const won = enrichClashTeamResults(team, [result]);
  expect(
    enrichClashTeamResults(won, [
      { ...result, win: false, resultSource: "RIOT" },
    ]).matches[0]?.result,
  ).toBe("lost");
  expect(
    enrichClashTeamResults(won, [{ ...result, win: false }]).matches[0]?.result,
  ).toBe("pending");
  expect(
    enrichClashTeamResults(team, [
      result,
      { ...result, puuid: "teammate", win: false },
    ]).matches[0]?.result,
  ).toBe("pending");
});

test("multiple linked games cannot imply an unknown series outcome", () => {
  const multi = {
    ...team,
    matches: team.matches.map((match) => ({
      ...match,
      gameIds: ["123", "124"],
    })),
  };
  expect(enrichClashTeamResults(multi, [result]).matches[0]?.result).toBe(
    "pending",
  );
});
