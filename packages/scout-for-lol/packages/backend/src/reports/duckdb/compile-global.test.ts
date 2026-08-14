import { describe, expect, test } from "bun:test";
import { parseAndCompile } from "@scout-for-lol/data";
import {
  compileGroupFactsQuery,
  compileMatchQuery,
  compilePrematchQuery,
  type LakeQueryInput,
} from "#src/reports/duckdb/compile.ts";
import type { LakeFiles } from "#src/reports/duckdb/lake.ts";
import { GLOBAL_SCOPE, guildScope } from "#src/reports/duckdb/scope.ts";
import {
  TEST_GUILD_ID,
  TEST_LAKE_FILES,
  paramValues,
} from "#src/testing/test-lake-files.ts";

/**
 * Global scope compiles the same ScoutQL plans against every participant of
 * every ingested match instead of one server's tracked accounts. These tests
 * pin the SQL shape; the behavioural proof (an account tracked by two servers
 * counting once) lives in reports/global-scope.integration.test.ts.
 */

function guildInput(queryText: string): LakeQueryInput {
  return {
    plan: parseAndCompile(queryText),
    scope: guildScope(TEST_GUILD_ID),
    startMs: 1_700_000_000_000,
    endMs: 1_700_600_000_000,
    files: TEST_LAKE_FILES,
  };
}

function globalInput(queryText: string): LakeQueryInput {
  return { ...guildInput(queryText), scope: GLOBAL_SCOPE };
}

describe("compile — global scope", () => {
  test("emits no accounts join and no server_id predicate", () => {
    const compiled = compileMatchQuery(
      globalInput(
        "SELECT player, games FROM match_participants GROUP BY player",
      ),
    );
    if (compiled === undefined) {
      throw new Error("expected compiled query");
    }
    // No accounts CTE means nothing to fan out: an account tracked by two
    // servers has two accounts rows, and joining them unscoped would double
    // every aggregate.
    expect(compiled.aggregateSql).not.toContain("accounts");
    expect(compiled.aggregateSql).not.toContain("server_id");
    expect(compiled.scannedSql).not.toContain("accounts");
    expect(compiled.scannedSql).not.toContain("server_id");
    expect(paramValues(compiled.aggregateParams)).not.toContain(TEST_GUILD_ID);
  });

  test("groups players by puuid and labels them with the Riot ID", () => {
    const compiled = compileMatchQuery(
      globalInput(
        "SELECT player, games FROM match_participants GROUP BY player",
      ),
    );
    if (compiled === undefined) {
      throw new Error("expected compiled query");
    }
    expect(compiled.aggregateSql).toContain("GROUP BY puuid");
    expect(compiled.aggregateSql).toContain(
      "concat_ws('#', m.riot_id_game_name, m.riot_id_tagline)",
    );
    // player_id / discord_id are NULL, so no leaderboard mention resolves.
    expect(compiled.aggregateSql).toContain("NULL::BIGINT AS player_id");
    expect(compiled.aggregateSql).toContain("NULL::VARCHAR AS discord_id");
  });

  test("compiles without accounts.parquet, which guild scope requires", () => {
    const withoutAccounts: LakeFiles = {
      ...TEST_LAKE_FILES,
      accountsParquet: undefined,
    };
    const queryText =
      "SELECT player, games FROM match_participants GROUP BY player";

    expect(
      compileMatchQuery({ ...globalInput(queryText), files: withoutAccounts }),
    ).toBeDefined();
    expect(
      compileMatchQuery({ ...guildInput(queryText), files: withoutAccounts }),
    ).toBeUndefined();
  });

  test("prematch labels from the pre-joined riot_id column", () => {
    const compiled = compilePrematchQuery(
      globalInput(
        "SELECT player, prematches FROM prematch_participants GROUP BY player",
      ),
    );
    if (compiled === undefined) {
      throw new Error("expected compiled query");
    }
    expect(compiled.aggregateSql).toContain("p.riot_id AS player_alias");
    expect(compiled.aggregateSql).not.toContain("accounts");
  });

  test("refuses teammate groups rather than reporting every team as a stack", () => {
    expect(() =>
      compileGroupFactsQuery(
        globalInput("SELECT group, games FROM player_groups GROUP BY group(2)"),
      ),
    ).toThrow(/not available in global scope/);
  });

  test("refuses competition player-id scoping, which is per-server", () => {
    expect(() =>
      compileMatchQuery({
        ...globalInput(
          "SELECT player, games FROM match_participants GROUP BY player",
        ),
        playerIds: [7],
      }),
    ).toThrow(/requires a guild scope/);
  });
});
