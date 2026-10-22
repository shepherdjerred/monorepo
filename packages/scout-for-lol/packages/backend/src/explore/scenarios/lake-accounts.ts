import path from "node:path";
import { z } from "zod";
import {
  LeaguePuuidSchema,
  type ExploreScenarioAccountSelector,
} from "@scout-for-lol/data";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import {
  regionForPlatform,
  type ScenarioAccount,
} from "#src/explore/scenarios/world.ts";

/**
 * Choosing real lake accounts for scenario fixtures.
 *
 * A fixture names a rule — "the account with the third most games", "the
 * busiest Brand player with a timeline" — and this resolves it against the
 * pinned build. Ties break on PUUID, so the same build always yields the same
 * account, and a selector already used in a case is skipped rather than
 * reused: two fixture players sharing one account would make every per-player
 * answer ambiguous.
 */

const AccountRowSchema = z.object({
  puuid: LeaguePuuidSchema,
  game_name: z.string().min(1),
  tag_line: z.string().min(1),
  platform_id: z.string().min(1),
  games: z.coerce.number().int().positive(),
});

/**
 * An account no lake row mentions.
 *
 * A UUID, which the PUUID schema accepts, and stable so the fixture
 * row is identical across runs.
 */
const UNRECORDED_ACCOUNT: ScenarioAccount = {
  puuid: LeaguePuuidSchema.parse("5ce4a710-0000-4000-8000-000000000001"),
  gameName: "Quillbert",
  tagLine: "NONE",
  region: "AMERICA_NORTH",
  games: 0,
};

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function resolveScenarioAccount(input: {
  readonly buildDir: string;
  readonly selector: ExploreScenarioAccountSelector;
  /** PUUIDs already taken in this case; skipped so fixtures never share one. */
  readonly exclude: ReadonlySet<string>;
}): Promise<ScenarioAccount> {
  const { selector } = input;
  if (selector.kind === "unrecorded") return UNRECORDED_ACCOUNT;

  const matches = quoteLiteral(
    path.join(input.buildDir, "matches", "**", "*.parquet"),
  );
  const coverage = quoteLiteral(
    path.join(input.buildDir, "timeline_coverage", "**", "*.parquet"),
  );
  const filters = [
    "riot_id_game_name is not null",
    "riot_id_tagline is not null",
    // Remakes are not games anyone would ask about.
    "game_duration_seconds >= 600",
    ...(selector.champion === undefined
      ? []
      : [`champion_name = ${quoteLiteral(selector.champion)}`]),
    ...(selector.withTimeline
      ? [
          `match_id in (select match_id from read_parquet(${coverage}, hive_partitioning = true))`,
        ]
      : []),
  ];
  const excluded =
    input.exclude.size === 0
      ? ""
      : `where puuid not in (${[...input.exclude].map((puuid) => quoteLiteral(puuid)).join(", ")})`;

  const sql = `
    with games as (
      select
        puuid,
        arg_max(riot_id_game_name, game_end_at) as game_name,
        arg_max(riot_id_tagline, game_end_at) as tag_line,
        arg_max(platform_id, game_end_at) as platform_id,
        count(*) as games
      from read_parquet(${matches}, hive_partitioning = true)
      where ${filters.join(" and ")}
      group by puuid
      having count(*) >= ${selector.minGames.toString()}
    )
    select * from games
    ${excluded}
    order by games desc, puuid
    limit 1 offset ${(selector.rank - 1).toString()}`;

  const rows = await withDuckDBConnection(
    async (session) => await session.run(sql),
  );
  const row = z.array(AccountRowSchema).parse(rows)[0];
  if (row === undefined) {
    throw new Error(
      `No lake account matches selector ${JSON.stringify(selector)}.`,
    );
  }
  return {
    puuid: row.puuid,
    gameName: row.game_name,
    tagLine: row.tag_line,
    region: regionForPlatform(row.platform_id),
    games: row.games,
  };
}
