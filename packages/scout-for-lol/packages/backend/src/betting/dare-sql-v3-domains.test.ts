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

  // A CTE may publish any name it likes, so a domain belongs to the lake column
  // rather than to the spelling: `COUNT(*) AS queue` is an integer.
  test("accepts a derived alias that reuses a lake domain column's name", async () => {
    await expect(
      compileDareSqlV3({
        queryText: `WITH counts AS (SELECT COUNT(*) AS queue FROM T1)
          SELECT queue >= 5 AS achieved FROM counts`,
        targetKeys: ["T1"],
      }),
    ).resolves.toMatchObject({ compilerVersion: "dare-scoutql-3" });
  });

  // The relaxation above must not become an escape hatch: a CTE that merely
  // forwards a lake column is still comparing the lake column.
  test("rejects an out-of-domain literal on a column a CTE forwards from the lake", async () => {
    await expect(
      compileDareSqlV3({
        queryText: `WITH lake_games AS (
            SELECT match_id, game_end_at, team_position FROM T1
          ), qualifying_game AS (
            SELECT match_id, game_end_at, (team_position = 'MID') AS matched
            FROM lake_games
          )
          SELECT EXISTS (SELECT 1 FROM qualifying_game WHERE matched) AS achieved`,
        targetKeys: ["T1"],
      }),
    ).rejects.toThrow("MIDDLE");
  });

  // A qualifier that names a lake relation is the shape the model writes most
  // often, and it stays checked whichever alias the FROM clause gave it.
  test("rejects an out-of-domain literal behind a lake table alias", async () => {
    await expect(
      compileDareSqlV3({
        queryText: `WITH qualifying_game AS (
            SELECT p0.match_id, p0.game_end_at,
              (p0.team_position = 'MID') AS matched
            FROM T1 AS p0
          )
          SELECT EXISTS (SELECT 1 FROM qualifying_game WHERE matched) AS achieved`,
        targetKeys: ["T1"],
      }),
    ).rejects.toThrow("MIDDLE");
  });
});

// Timeline reads must also read timeline_coverage, so missing data cannot be
// treated as zero — the same failure class this domain check exists for.
function timelineContract(predicate: string): string {
  return `SELECT EXISTS (
      SELECT 1 FROM timeline_coverage c
        JOIN T1 p USING (match_id)
        JOIN timeline_events e USING (match_id)
      WHERE ${predicate}
    ) AS achieved`;
}

describe("Dare SQL v3 timeline event types", () => {
  // v3 exposes timeline_events as a source table rather than a macro, so an
  // invented event type is an ordinary column comparison — and one that returns
  // a count of zero, which reads as a lost dare rather than a broken contract.
  test("rejects an event type Riot never emits", async () => {
    await expect(
      compileDareSqlV3({
        queryText: timelineContract("e.event_type = 'DRAGON_KILL'"),
        targetKeys: ["T1"],
      }),
    ).rejects.toThrow("not a timeline event type");
  });

  test("rejects BUILDING_DESTROYED, which an old docs table invented", async () => {
    await expect(
      compileDareSqlV3({
        queryText: timelineContract("e.event_type = 'BUILDING_DESTROYED'"),
        targetKeys: ["T1"],
      }),
    ).rejects.toThrow("not a timeline event type");
  });

  test("accepts the event type a dragon kill actually uses", async () => {
    await expect(
      compileDareSqlV3({
        queryText: timelineContract("e.event_type = 'ELITE_MONSTER_KILL'"),
        targetKeys: ["T1"],
      }),
    ).resolves.toMatchObject({ compilerVersion: "dare-scoutql-3" });
  });
});
