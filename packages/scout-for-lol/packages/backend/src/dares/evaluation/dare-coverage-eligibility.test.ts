import { describe, expect, test } from "vitest";
import {
  dareCoverageEligibility,
  dareEndOfGameEligibility,
} from "#src/dares/evaluation/dare-coverage-eligibility.ts";
import { compileDareSql } from "#src/dares/sql/dare-sql.ts";
import { loadRiftFixture } from "#src/dares/dare-test-fixtures.ts";
import { classicEndOfGameMatch } from "#src/testing/scout-client/end-of-game-fixtures.ts";

/** A one-game-set contract whose game set reads `predicate` from `T1`. */
function playerContract(predicate: string) {
  return compileDareSql({
    queryText: `WITH qualifying_game AS (
      SELECT match_id, game_end_at, (${predicate}) AS matched FROM T1
    )
    SELECT EXISTS (SELECT 1 FROM qualifying_game WHERE matched) AS achieved`,
    targetKeys: ["T1"],
  });
}

describe("Dare eligibility by coverage", () => {
  test("a contract that reads only stated columns is eligible", async () => {
    const compiled = await playerContract("win AND kills >= 5");

    expect(dareEndOfGameEligibility(compiled)).toEqual({ kind: "eligible" });
  });

  test("a contract that reads a null column is ineligible, never failed", async () => {
    const compiled = await playerContract("participant_id = 1 AND win");

    expect(dareEndOfGameEligibility(compiled)).toEqual({
      kind: "ineligible",
      reason: "unstated_column",
      references: ["participant_id"],
    });
  });

  test("the game version is a null column too", async () => {
    const compiled = await playerContract("game_version = '15.1.1'");

    expect(dareEndOfGameEligibility(compiled)).toMatchObject({
      kind: "ineligible",
      references: ["game_version"],
    });
  });

  test("a contract that reads a team objective Rift Herald count is ineligible", async () => {
    const compiled = await compileDareSql({
      queryText: `WITH qualifying_game AS (
        SELECT t.match_id, t.win, t.first_rift_herald AS matched, TRUE AS in_game
        FROM match_teams AS t
      ), game_set AS (
        SELECT p.match_id, p.game_end_at, g.matched FROM T1 AS p
        JOIN qualifying_game AS g ON g.match_id = p.match_id AND g.win = p.win
      )
      SELECT EXISTS (SELECT 1 FROM game_set WHERE matched) AS achieved`,
      targetKeys: ["T1"],
    });

    expect(dareEndOfGameEligibility(compiled)).toMatchObject({
      kind: "ineligible",
      references: ["first_rift_herald"],
    });
  });

  test("a contract that reads a timeline relation is ineligible", async () => {
    const compiled = await compileDareSql({
      queryText: `WITH qualifying_game AS (
        SELECT p.match_id, p.game_end_at,
          EXISTS (SELECT 1 FROM timeline_events AS e WHERE e.match_id = p.match_id AND e.event_type = 'CHAMPION_KILL')
            AND EXISTS (SELECT 1 FROM timeline_coverage AS c WHERE c.match_id = p.match_id) AS matched
        FROM T1 AS p
      )
      SELECT EXISTS (SELECT 1 FROM qualifying_game WHERE matched) AS achieved`,
      targetKeys: ["T1"],
    });

    expect(dareEndOfGameEligibility(compiled)).toMatchObject({
      kind: "ineligible",
      reason: "timeline_relation",
      references: ["timeline_coverage", "timeline_events"],
    });
  });

  test("a CTE's own column that shares a lake name is not the lake's", async () => {
    const compiled = await compileDareSql({
      queryText: `WITH qualifying_game AS (
        SELECT match_id, game_end_at, COUNT(*) AS participant_id, COUNT(*) >= 1 AS matched
        FROM T1 GROUP BY match_id, game_end_at
      )
      SELECT EXISTS (SELECT 1 FROM qualifying_game WHERE matched AND participant_id >= 1) AS achieved`,
      targetKeys: ["T1"],
    });

    expect(dareEndOfGameEligibility(compiled)).toEqual({ kind: "eligible" });
  });

  test("a CTE that renames a stated column to a null column's name stays eligible", async () => {
    const compiled = await compileDareSql({
      queryText: `WITH qualifying_game AS (
        SELECT match_id, game_end_at, team_position AS role, win AS matched FROM T1
      )
      SELECT EXISTS (SELECT 1 FROM qualifying_game WHERE matched AND role = 'MIDDLE') AS achieved`,
      targetKeys: ["T1"],
    });

    expect(dareEndOfGameEligibility(compiled)).toEqual({ kind: "eligible" });
  });

  test("a CTE that renames a null column is ineligible where it reads it", async () => {
    const compiled = await compileDareSql({
      queryText: `WITH qualifying_game AS (
        SELECT match_id, game_end_at, role AS position, win AS matched FROM T1
      )
      SELECT EXISTS (SELECT 1 FROM qualifying_game WHERE matched AND position = 'MIDDLE') AS achieved`,
      targetKeys: ["T1"],
    });

    expect(dareEndOfGameEligibility(compiled)).toMatchObject({
      kind: "ineligible",
      references: ["role"],
    });
  });

  test("coverage decides: a complete game is eligible for a contract an end-of-game game is not", async () => {
    const compiled = await playerContract("participant_id = 1");

    expect(
      dareCoverageEligibility(await classicEndOfGameMatch(), compiled).kind,
    ).toBe("ineligible");
    expect(
      dareCoverageEligibility(await loadRiftFixture(), compiled).kind,
    ).toBe("eligible");
  });
});
