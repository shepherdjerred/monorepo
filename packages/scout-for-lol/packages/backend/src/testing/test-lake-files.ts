import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import type { BoundParam, LakeFiles } from "#src/reports/duckdb/lake.ts";

/**
 * Shared fixtures for the ScoutQL compiler tests.
 *
 * These describe file paths only — nothing here touches the filesystem. The
 * compiler embeds paths as bound parameters, so the tests assert on generated
 * SQL text and parameter lists rather than executing anything.
 */

export const TEST_GUILD_ID = DiscordGuildIdSchema.parse("123456789012345678");

export const TEST_LAKE_FILES: LakeFiles = {
  matchesParquet: ["/lake/builds/b1/matches/month=2026-07/data_0.parquet"],
  matchesStaging: ["/lake/matches-recent/NA1_1.jsonl"],
  prematchParquet: ["/lake/builds/b1/prematch/month=2026-07/data_0.parquet"],
  prematchStaging: [],
  accountsParquet: "/lake/builds/b1/accounts/accounts.parquet",
  competitionRankHistoryParquet: [],
  competitionRankHistoryStaging: [],
};

/** Flatten bound parameters to the scalar values they carry. */
export function paramValues(
  params: BoundParam[],
): (string | number | boolean)[] {
  return params.flatMap((param) =>
    param.kind === "list" ? param.values : [param.value],
  );
}
