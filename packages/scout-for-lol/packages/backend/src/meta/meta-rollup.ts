import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { assembleMetaServing } from "#src/meta/meta-assemble.ts";
import {
  championFilePath,
  DEFAULT_META_THRESHOLDS,
  matchupFilePath,
  META_BRACKET_TIERS,
  META_SERVING_DIR,
  type MetaThresholds,
} from "@scout-for-lol/data/meta/meta-serving.ts";
import {
  META_PARTIALS_TABLE,
  META_PARTIALS_VERSION,
  MetaPartialKindSchema,
  parquetFiles,
} from "#src/report-lake/crawl/meta-partials.ts";
import { withMaintenanceDuckDBConnection } from "#src/reports/duckdb/instance.ts";

/**
 * The roll-up: sums a build's daily partials over its retained days and
 * writes the serving JSON (`meta-serving.ts`) into that same build.
 *
 * It runs inside the build that is about to be published, after crawl
 * erasure, never against `CURRENT`: the JSON is then exactly the sum of the
 * partials the build publishes. It replaces the build's `meta/v1` wholesale,
 * so it is idempotent and a stale file cannot survive a run. It is written to
 * a staging directory and renamed into place, so a failed run leaves the
 * build's previous serving files (a hardlinked copy of the published ones)
 * or none, never half of a new set.
 */

const ROLLUP_TIMEOUT_MS = 30 * 60 * 1000;

const NumberLikeSchema = z.union([z.bigint(), z.number()]).transform(Number);

const RollupRowSchema = z.object({
  kind: MetaPartialKindSchema,
  patch: z.string(),
  queue_id: NumberLikeSchema,
  bracket: z.string(),
  role: z.string(),
  champion_id: NumberLikeSchema,
  key1: z.string(),
  key2: z.string(),
  games: NumberLikeSchema,
  wins: NumberLikeSchema,
  kind_total: NumberLikeSchema,
});

function bracketCase(): string {
  const arms = Object.entries(META_BRACKET_TIERS).map(
    ([bracket, tiers]) =>
      `WHEN tier IN (${tiers.map((tier) => `'${tier}'`).join(", ")}) THEN '${bracket}'`,
  );
  return `CASE ${arms.join(" ")} END`;
}

function rollupSql(thresholds: MetaThresholds): string {
  const entry = thresholds.minEntryGames.toString();
  const matchup = thresholds.minMatchupGames.toString();
  return `
WITH src AS (
  SELECT *, ${bracketCase()} AS grp
  FROM read_parquet($1, hive_partitioning = false)
), agg AS (
  SELECT kind, patch, queue_id, grp AS bracket, role, champion_id, key1, key2,
    sum(games) AS games, sum(wins) AS wins
  FROM src WHERE grp IS NOT NULL GROUP BY ALL
  UNION ALL
  SELECT kind, patch, queue_id, 'all' AS bracket, role, champion_id, key1, key2,
    sum(games) AS games, sum(wins) AS wins
  FROM src GROUP BY ALL
), totalled AS (
  SELECT *, sum(games) OVER (PARTITION BY kind, patch, queue_id, bracket, role, champion_id) AS kind_total
  FROM agg
)
SELECT kind, patch, queue_id, bracket, role, champion_id, key1, key2, games, wins, kind_total
FROM totalled
WHERE kind IN ('matches', 'champion', 'ban', 'trait_base')
  OR (kind = 'matchup' AND games >= ${matchup})
  OR (kind NOT IN ('matches', 'champion', 'ban', 'trait_base', 'matchup') AND games >= ${entry})
ORDER BY kind, patch, queue_id, bracket, role, champion_id, key1, key2`;
}

export type MetaRollupSummary = {
  written: boolean;
  days: number;
  champions: number;
  tierFiles: number;
  slices: number;
};

async function currentPartialFiles(
  buildDir: string,
): Promise<{ files: string[]; days: string[] }> {
  const root = path.join(buildDir, META_PARTIALS_TABLE);
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { files: [], days: [] };
    }
    throw error;
  }
  const prefix = `partials-v${META_PARTIALS_VERSION.toString()}-`;
  const files: string[] = [];
  const days: string[] = [];
  for (const name of names.toSorted()) {
    if (!name.startsWith("ingest_day=")) continue;
    const dayFiles = await parquetFiles(path.join(root, name), prefix);
    if (dayFiles.length === 0) continue;
    days.push(name.slice("ingest_day=".length));
    files.push(...dayFiles);
  }
  return { files, days };
}

async function writeJson(root: string, relative: string, value: unknown) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await Bun.write(target, `${JSON.stringify(value)}\n`);
}

/**
 * Sum the build's partials and replace its `meta/v1` with the serving files.
 * A build with no partials has no serving files: any carried copy is removed
 * rather than left to describe data the build no longer holds.
 */
export async function rollUpMeta(input: {
  buildDir: string;
  buildId: string;
  now: Date;
  thresholds?: MetaThresholds;
  abortSignal?: AbortSignal | undefined;
}): Promise<MetaRollupSummary> {
  const thresholds = input.thresholds ?? DEFAULT_META_THRESHOLDS;
  const servingDir = path.join(input.buildDir, META_SERVING_DIR);
  const metaRoot = path.dirname(servingDir);
  const { files, days } = await currentPartialFiles(input.buildDir);
  if (files.length === 0) {
    await rm(metaRoot, { recursive: true, force: true });
    return { written: false, days: 0, champions: 0, tierFiles: 0, slices: 0 };
  }
  const rows = await withMaintenanceDuckDBConnection(
    async (session) => {
      const raw = await session.run(rollupSql(thresholds), [
        session.list(files),
      ]);
      return raw.map((row) => RollupRowSchema.parse(row));
    },
    {
      timeoutMs: ROLLUP_TIMEOUT_MS,
      ...(input.abortSignal === undefined
        ? {}
        : { abortSignal: input.abortSignal }),
    },
  );
  input.abortSignal?.throwIfAborted();
  const serving = assembleMetaServing({
    rows,
    days,
    buildId: input.buildId,
    now: input.now,
    thresholds,
  });

  const staging = path.join(input.buildDir, `.meta-${input.buildId}`);
  await rm(staging, { recursive: true, force: true });
  await writeJson(staging, "manifest.json", serving.manifest);
  for (const [relative, file] of serving.tiers) {
    await writeJson(staging, relative, file);
  }
  for (const [championId, file] of serving.champions) {
    await writeJson(staging, championFilePath(championId), file);
  }
  for (const [championId, file] of serving.matchups) {
    await writeJson(staging, matchupFilePath(championId), file);
  }
  // The old directory holds hardlinks shared with the published build:
  // unlinking them leaves that build's files alone.
  await rm(metaRoot, { recursive: true, force: true });
  await mkdir(metaRoot, { recursive: true });
  await rename(staging, servingDir);
  return {
    written: true,
    days: days.length,
    champions: serving.champions.size,
    tierFiles: serving.tiers.size,
    slices: [...serving.champions.values()].reduce(
      (total, file) => total + file.slices.length,
      0,
    ),
  };
}
