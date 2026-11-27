import { z } from "zod";
import type { LakePage } from "#src/reports/duckdb/consumer/pages/lake-page.ts";
import { runSource } from "#src/reports/duckdb/lake/statement.ts";
import { buildMatchesSource, listParam } from "#src/reports/duckdb/lake.ts";

const LakeInt = z.union([z.bigint(), z.number()]).transform(Number);

const AccountChampionRowSchema = z.object({
  puuid: z.string(),
  champion_id: LakeInt,
  champion_name: z.string(),
  games: LakeInt,
  wins: LakeInt,
});

export type AccountChampionRow = z.infer<typeof AccountChampionRowSchema>;

/**
 * Games and wins per account and champion, over the lake `queues`. The PUUID
 * list is the caller's whole authorization surface, as for every profile read.
 * Ordered, so equal totals never shift between requests.
 */
export async function readAccountChampions(
  page: LakePage,
  options: { puuids: string[]; queues: string[] },
): Promise<AccountChampionRow[]> {
  if (options.puuids.length === 0) return [];
  const source = buildMatchesSource(page.files, {
    sql: "puuid IN (SELECT unnest(?)) AND queue IN (SELECT unnest(?))",
    params: [listParam(options.puuids), listParam(options.queues)],
  });
  if (source === undefined) return [];
  return await runSource({
    session: page.session,
    source,
    sql:
      `SELECT puuid, champion_id, any_value(champion_name) AS champion_name, ` +
      `count(DISTINCT match_id)::BIGINT AS games, ` +
      `count(DISTINCT match_id) FILTER (WHERE win)::BIGINT AS wins ` +
      `FROM (${source.sql}) GROUP BY puuid, champion_id ORDER BY puuid, champion_id`,
    schema: AccountChampionRowSchema,
  });
}
