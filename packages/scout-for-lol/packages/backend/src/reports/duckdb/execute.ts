import type { DiscordGuildId, ReportQueryPlan } from "@scout-for-lol/data";
import type { DuckDBValue } from "@duckdb/node-api";
import { match } from "ts-pattern";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import type { AggregateRow } from "#src/reports/query-aggregates.ts";
import {
  compileMatchQuery,
  compilePairQuery,
  compilePrematchQuery,
  type CompiledLakeQuery,
  type LakeQueryInput,
} from "#src/reports/duckdb/compile.ts";
import {
  withDuckDBConnection,
  type DuckDBSession,
} from "#src/reports/duckdb/instance.ts";
import { resolveLakeFiles, type BoundParam } from "#src/reports/duckdb/lake.ts";
import {
  LakeAggregateRowSchema,
  LakeScannedRowSchema,
} from "#src/reports/duckdb/row-schema.ts";

export type LakeAggregationResult = {
  aggregates: AggregateRow[];
  rowsScanned: number;
};

const EMPTY_RESULT: LakeAggregationResult = { aggregates: [], rowsScanned: 0 };

function bindParams(
  session: DuckDBSession,
  params: BoundParam[],
): DuckDBValue[] {
  return params.map((param) =>
    param.kind === "list" ? session.list(param.values) : param.value,
  );
}

/**
 * Execute a fact-style ScoutQL plan against the report lake and return raw
 * aggregate rows (all counters, ungrouped by metrics) plus the scanned-row
 * count. Sorting, minGames, limits, and metric derivation stay in JS —
 * callers feed the result through sortedAggregates/rowsFromAggregates.
 */
export async function runLakeAggregation(input: {
  plan: ReportQueryPlan;
  serverId: DiscordGuildId;
  startDate: Date;
  endDate: Date;
  playerIds?: number[];
  lakeDir?: string;
}): Promise<LakeAggregationResult> {
  const lakeDir = input.lakeDir ?? resolveLakeDir();
  const files = await resolveLakeFiles(lakeDir);

  const queryInput: LakeQueryInput = {
    plan: input.plan,
    serverId: input.serverId,
    startMs: input.startDate.getTime(),
    endMs: input.endDate.getTime(),
    ...(input.playerIds === undefined ? {} : { playerIds: input.playerIds }),
    files,
  };

  const compiled: CompiledLakeQuery | undefined = match(input.plan.source)
    .with("match_participants", "competition_match_participants", () =>
      compileMatchQuery(queryInput),
    )
    .with("player_pairs", () => compilePairQuery(queryInput))
    .with("prematch_participants", () => compilePrematchQuery(queryInput))
    .with("rank_current", "competition_rank", () => {
      throw new Error(`rank sources are not lake-backed: ${input.plan.source}`);
    })
    .exhaustive();

  if (compiled === undefined) {
    // Fresh install / empty lake: same behavior as "no facts yet".
    return EMPTY_RESULT;
  }

  return await withDuckDBConnection(async (session) => {
    const aggregateRows = await session.run(
      compiled.aggregateSql,
      bindParams(session, compiled.aggregateParams),
    );
    const scannedRows = await session.run(
      compiled.scannedSql,
      bindParams(session, compiled.scannedParams),
    );

    const aggregates = aggregateRows.map((row) => {
      const parsed = LakeAggregateRowSchema.parse(row);
      return {
        label: parsed.label,
        discordId: parsed.discord_id,
        games: parsed.games,
        wins: parsed.wins,
        surrenders: parsed.surrenders,
        kills: parsed.kills,
        deaths: parsed.deaths,
        assists: parsed.assists,
        creepScore: parsed.creep_score,
        damageToChampions: parsed.damage_to_champions,
        goldEarned: parsed.gold_earned,
        visionScore: parsed.vision_score,
        damageTaken: parsed.damage_taken,
        totalDamageDealt: parsed.total_damage_dealt,
        wardsPlaced: parsed.wards_placed,
        multikills: parsed.multikills,
        durationSeconds: parsed.duration_seconds,
        timePlayedSeconds: parsed.time_played_seconds,
      };
    });
    const rowsScanned = LakeScannedRowSchema.parse(scannedRows[0]).scanned;
    return { aggregates, rowsScanned };
  });
}
