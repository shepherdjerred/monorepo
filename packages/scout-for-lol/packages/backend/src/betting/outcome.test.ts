import { describe, expect, test } from "vitest";
import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data/index.ts";
import { classifyMatchForBetting } from "#src/betting/outcome.ts";

/**
 * A real completed ranked flex 5v5, parsed through the strict schema so these
 * fixtures break loudly if Riot's shape changes rather than silently testing a
 * payload the production path would reject.
 */
const fixture = RawMatchSchema.parse(
  await Bun.file(
    new URL("../../../../testdata/rift.json", import.meta.url),
  ).json(),
);

/** A real Arena match: 16 participants and a team list that carries teamId 0.
 * Kept as the negative case because Arena games do get prematch messages
 * today, so refusing them is load-bearing rather than theoretical. */
const arenaFixture = RawMatchSchema.parse(
  await Bun.file(
    new URL(
      "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
      import.meta.url,
    ),
  ).json(),
);

function withInfo(overrides: Partial<RawMatch["info"]>): RawMatch {
  return RawMatchSchema.parse({
    ...fixture,
    info: { ...fixture.info, ...overrides },
  });
}

describe("classifyMatchForBetting", () => {
  test("reads the winning team from a completed match", () => {
    const result = classifyMatchForBetting(fixture);
    expect(result.kind).toBe("decided");

    const winningTeam = fixture.info.teams.find((team) => team.win);
    if (winningTeam === undefined || result.kind !== "decided") {
      throw new Error("fixture should be a decided match");
    }
    expect(result.winningTeamId).toBe(winningTeam.teamId);
  });

  test("voids a match that did not complete", () => {
    const result = classifyMatchForBetting(
      withInfo({ endOfGameResult: "Abort_Unexpected" }),
    );
    expect(result).toEqual({ kind: "void", reason: "remake" });
  });

  test("voids a game shorter than the remake threshold", () => {
    const result = classifyMatchForBetting(withInfo({ gameDuration: 240 }));
    expect(result).toEqual({ kind: "void", reason: "remake" });
  });

  test("a game at exactly the remake threshold is still bettable", () => {
    const result = classifyMatchForBetting(withInfo({ gameDuration: 300 }));
    expect(result.kind).toBe("decided");
  });

  test("voids when any participant reports an early surrender", () => {
    const participants = fixture.info.participants.map((participant, index) =>
      index === 0
        ? { ...participant, gameEndedInEarlySurrender: true }
        : participant,
    );
    const result = classifyMatchForBetting(withInfo({ participants }));
    expect(result).toEqual({ kind: "void", reason: "remake" });
  });

  test("voids when a team reports an early surrender", () => {
    const participants = fixture.info.participants.map((participant, index) =>
      index === 3
        ? { ...participant, teamEarlySurrendered: true }
        : participant,
    );
    const result = classifyMatchForBetting(withInfo({ participants }));
    expect(result).toEqual({ kind: "void", reason: "remake" });
  });

  test("an ordinary surrender is a real, bettable loss", () => {
    // gameEndedInSurrender is not gameEndedInEarlySurrender: a 20-minute FF is
    // a genuine result that bets must settle against.
    const participants = fixture.info.participants.map((participant) => ({
      ...participant,
      gameEndedInSurrender: true,
    }));
    const result = classifyMatchForBetting(withInfo({ participants }));
    expect(result.kind).toBe("decided");
  });

  test("voids a lobby that is not ten participants", () => {
    const result = classifyMatchForBetting(
      withInfo({ participants: fixture.info.participants.slice(0, 8) }),
    );
    expect(result).toEqual({ kind: "void", reason: "unsupported_mode" });
  });

  test("voids a lobby that is not split five and five", () => {
    const participants = fixture.info.participants.map((participant, index) =>
      index === 0 ? { ...participant, teamId: 200 } : participant,
    );
    const result = classifyMatchForBetting(withInfo({ participants }));
    expect(result).toEqual({ kind: "void", reason: "unsupported_mode" });
  });

  test("voids when no single team is marked as the winner", () => {
    const teams = fixture.info.teams.map((team) => ({ ...team, win: true }));
    const result = classifyMatchForBetting(withInfo({ teams }));
    expect(result).toEqual({ kind: "void", reason: "unsupported_mode" });
  });

  test("refuses a real Arena match", () => {
    // 16 participants and no binary team outcome. This is the case that would
    // strand stakes in a market nobody could pay out.
    const result = classifyMatchForBetting(arenaFixture);
    expect(result).toEqual({ kind: "void", reason: "unsupported_mode" });
  });

  test("an unreadable payload is unsupported_mode, not a remake", () => {
    // A short game we cannot even read a winner from should not be labelled a
    // remake — that would put a misleading reason in the ledger.
    const teams = fixture.info.teams.map((team) => ({ ...team, win: false }));
    const result = classifyMatchForBetting(
      withInfo({ teams, gameDuration: 60 }),
    );
    expect(result).toEqual({ kind: "void", reason: "unsupported_mode" });
  });
});
