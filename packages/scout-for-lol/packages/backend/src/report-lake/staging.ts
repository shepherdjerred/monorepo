import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { RawCurrentGameInfo, RawMatch } from "@scout-for-lol/data";
import { createLogger } from "#src/logger.ts";
import { reportLakeStagingWritesTotal } from "#src/metrics/report-lake.ts";
import { flattenMatch, flattenPrematch } from "#src/report-lake/flatten.ts";
import {
  ensureLakeScaffold,
  matchesStagingDir,
  prematchStagingDir,
} from "#src/report-lake/paths.ts";

const logger = createLogger("report-lake-staging");

/**
 * Ingest-time staging: one NDJSON file per match / prematch observation,
 * named by its natural id so re-ingest is an idempotent whole-file overwrite
 * (Bun.write) — no append races, no torn lines. The DuckDB engine unions
 * these files with the published parquet build (deduped, parquet preferred)
 * so a match is queryable seconds after ingest instead of after the next
 * compaction; compaction folds them into parquet and deletes them.
 *
 * Staging writes MUST never fail ingest — they are redundant with the next
 * compaction run, which reads the same data back out of the Stored* tables.
 * Callers get a boolean and a metric, not an exception.
 */

function sanitizeFileStem(stem: string): string {
  return stem.replaceAll(/[^\w.-]/g, "_");
}

export function matchStagingFilePath(lakeDir: string, matchId: string): string {
  return path.join(
    matchesStagingDir(lakeDir),
    `${sanitizeFileStem(matchId)}.jsonl`,
  );
}

export function prematchStagingFilePath(
  lakeDir: string,
  dedupeKey: string,
): string {
  return path.join(
    prematchStagingDir(lakeDir),
    `${sanitizeFileStem(dedupeKey)}.jsonl`,
  );
}

function toNdjson(rows: object[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

export async function writeMatchStagingFile(
  lakeDir: string,
  match: RawMatch,
): Promise<boolean> {
  try {
    await ensureLakeScaffold(lakeDir);
    const rows = flattenMatch(match);
    await Bun.write(
      matchStagingFilePath(lakeDir, match.metadata.matchId),
      toNdjson(rows),
    );
    reportLakeStagingWritesTotal.inc({ table: "matches", status: "success" });
    return true;
  } catch (error) {
    logger.warn(
      `Failed to write match staging file for ${match.metadata.matchId}`,
      { error },
    );
    reportLakeStagingWritesTotal.inc({ table: "matches", status: "failed" });
    return false;
  }
}

export async function writePrematchStagingFile(
  lakeDir: string,
  gameInfo: RawCurrentGameInfo,
  observedAt: Date,
): Promise<boolean> {
  const dedupeKey = `${gameInfo.platformId}:${gameInfo.gameId.toString()}`;
  try {
    await ensureLakeScaffold(lakeDir);
    const rows = flattenPrematch(gameInfo, observedAt);
    if (rows.length === 0) {
      // Every participant was privacy-scrubbed; nothing to stage.
      return true;
    }
    await Bun.write(
      prematchStagingFilePath(lakeDir, dedupeKey),
      toNdjson(rows),
    );
    reportLakeStagingWritesTotal.inc({ table: "prematch", status: "success" });
    return true;
  } catch (error) {
    logger.warn(`Failed to write prematch staging file for ${dedupeKey}`, {
      error,
    });
    reportLakeStagingWritesTotal.inc({ table: "prematch", status: "failed" });
    return false;
  }
}

/** List absolute paths of all staging files for a table. */
export async function listStagingFiles(
  lakeDir: string,
  table: "matches" | "prematch",
): Promise<string[]> {
  const dir =
    table === "matches"
      ? matchesStagingDir(lakeDir)
      : prematchStagingDir(lakeDir);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return names
    .filter((name) => name.endsWith(".jsonl"))
    .toSorted()
    .map((name) => path.join(dir, name));
}

/**
 * Delete staging files whose natural ids were provably folded into a
 * published build. Ids not in the folded set are left for the next run.
 */
export async function removeFoldedStagingFiles(
  lakeDir: string,
  table: "matches" | "prematch",
  foldedIds: Set<string>,
): Promise<number> {
  const files = await listStagingFiles(lakeDir, table);
  let removed = 0;
  for (const file of files) {
    const stem = file
      .split("/")
      .at(-1)
      ?.replace(/\.jsonl$/, "");
    if (stem !== undefined && foldedIds.has(stem)) {
      await unlink(file);
      removed += 1;
    }
  }
  return removed;
}

/** The sanitized natural id a staging file would use — for fold bookkeeping. */
export function stagingIdForMatch(matchId: string): string {
  return sanitizeFileStem(matchId);
}

export function stagingIdForPrematch(dedupeKey: string): string {
  return sanitizeFileStem(dedupeKey);
}
