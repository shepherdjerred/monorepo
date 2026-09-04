import { describe, expect, test } from "vitest";
import { compileDareSqlV3 } from "#src/betting/dare-sql-v3.ts";

/** A one-game-set contract whose game set carries `predicate`. */
function contract(predicate: string): string {
  return `WITH qualifying_game AS (
      SELECT match_id, game_end_at, (${predicate}) AS matched FROM T1
    )
    SELECT EXISTS (SELECT 1 FROM qualifying_game WHERE matched) AS achieved`;
}

function compile(predicate: string) {
  return compileDareSqlV3({
    queryText: contract(predicate),
    targetKeys: ["T1"],
  });
}

describe("Dare SQL v3 value domains", () => {
  // v3 keeps no typed plan, so this AST walk is the only thing standing between
  // an invented lane spelling and a funded, unwinnable contract.
  test("rejects a team position Riot never emits", async () => {
    await expect(compile("team_position = 'MID'")).rejects.toThrow("MIDDLE");
  });

  test("rejects SUPPORT, which Riot records as UTILITY", async () => {
    await expect(compile("team_position = 'SUPPORT'")).rejects.toThrow(
      "UTILITY",
    );
  });

  test("accepts the position Riot actually writes", async () => {
    await expect(compile("team_position = 'MIDDLE'")).resolves.toMatchObject({
      compilerVersion: "dare-scoutql-3",
    });
  });

  // `'MID' = p0.team_position` is the same authoring mistake written backwards.
  test("rejects an out-of-domain literal on either side of the comparison", async () => {
    await expect(compile("'MID' = team_position")).rejects.toThrow("MIDDLE");
  });

  test("rejects an unknown champion", async () => {
    await expect(compile("champion_name = 'Ahriii'")).rejects.toThrow(
      "not a known champion",
    );
  });

  test("accepts a champion written as its display name", async () => {
    await expect(
      compile("champion_name = 'Twisted Fate'"),
    ).resolves.toMatchObject({ compilerVersion: "dare-scoutql-3" });
  });

  test("rejects an out-of-domain queue in an IN list", async () => {
    await expect(compile("queue IN ('RANKED_FLEX_SR')")).rejects.toThrow(
      "not a queue",
    );
  });

  test("accepts a real queue in an IN list", async () => {
    await expect(compile("queue IN ('solo', 'flex')")).resolves.toMatchObject({
      compilerVersion: "dare-scoutql-3",
    });
  });

  // Columns without a closed domain must be left alone, or every numeric dare
  // would start failing to compile.
  test("leaves numeric comparisons alone", async () => {
    await expect(compile("kills >= 5")).resolves.toMatchObject({
      compilerVersion: "dare-scoutql-3",
    });
  });

  test("ignores a comparison between two columns", async () => {
    await expect(
      compile("team_position = individual_position"),
    ).resolves.toMatchObject({ compilerVersion: "dare-scoutql-3" });
  });
});
