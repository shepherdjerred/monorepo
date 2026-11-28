import path from "node:path";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import type { LeaguePuuid } from "@scout-for-lol/data";
import type { LaneResultReadRow } from "#src/report-lake/lane-results/lane-result-columns.ts";
import { readCurrentBuildDir } from "#src/report-lake/paths.ts";
import { lakeSchemaFingerprint } from "#src/report-lake/schema.ts";
import {
  writeLaneResultsParquet,
  type LaneResultsWritten,
} from "#src/report-lake/lane-results/derive-lane-results.ts";
import { resolveLakeFiles } from "#src/reports/duckdb/lake.ts";

/**
 * Test helper: publish `lane_results` for a test lake written by
 * `writeTestLake`, as a rebuild at the current schema would. Without this the
 * test lake models the migration's predecessor build, whose lane results are
 * gated.
 *
 * `derive: false` records the current schema but derives nothing: a rebuilt
 * lake whose `lane_results` holds no rows yet.
 */
export async function deriveTestLaneResults(
  lakeDir: string,
  options: { derive?: boolean } = {},
): Promise<LaneResultsWritten | undefined> {
  const buildDir = await readCurrentBuildDir(lakeDir);
  if (buildDir === undefined) throw new Error("test lake has no build");
  await Bun.write(
    path.join(buildDir, "manifest.json"),
    JSON.stringify({ schemaFingerprint: lakeSchemaFingerprint() }),
  );
  if (options.derive === false) return undefined;
  return await writeLaneResultsParquet({
    buildDir,
    inputs: await resolveLakeFiles(lakeDir),
    scope: "all",
    derivedAt: new Date(),
    timeoutMs: 60_000,
  });
}

/**
 * Test helper: a hand-built `lane_results` read row for a mid laner.
 * `goldDiff: null` is a game with no 15:00 checkpoint.
 */
export function testLaneResultRow(options: {
  /** The match's number; the id is `NA1_<number>`. */
  matchId: number;
  puuid: LeaguePuuid | null;
  goldDiff: number | null;
  win?: boolean;
}): LaneResultReadRow {
  const checkpoint = options.goldDiff !== null;
  return {
    match_id: RiotMatchIdSchema.parse(`NA1_${options.matchId.toString()}`),
    month: "2026-11",
    game_created_ms: 1_700_000_000_000,
    queue_id: 420,
    puuid: options.puuid,
    participant_id: 3,
    team_id: 100,
    role: "middle",
    champion_id: 103,
    opponent_participant_id: 8,
    opponent_puuid: null,
    opponent_champion_id: 134,
    win: options.win ?? true,
    has_timeline: checkpoint,
    checkpoint_timestamp_ms: checkpoint ? 900_303 : null,
    checkpoint_complete: checkpoint ? true : null,
    gold_diff_at_15: options.goldDiff,
    cs_diff_at_15: checkpoint ? 0 : null,
    xp_diff_at_15: checkpoint ? 0 : null,
  };
}
