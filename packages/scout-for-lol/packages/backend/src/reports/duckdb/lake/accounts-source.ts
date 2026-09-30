import {
  listParam,
  scalarParam,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";

/** accounts dimension scoped to one Discord server. */
export function buildAccountsSource(
  accountsParquet: string,
  serverId: string,
): SqlFragment {
  return {
    sql: `SELECT puuid, player_id, player_alias, discord_id FROM read_parquet(?) WHERE server_id = ?`,
    params: [listParam([accountsParquet]), scalarParam(serverId)],
  };
}
