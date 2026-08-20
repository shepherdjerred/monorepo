import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import configuration from "#src/configuration.ts";
import { lakeSchemaFingerprint } from "#src/report-lake/schema.ts";

/**
 * Report-lake directory layout and the atomic CURRENT-pointer publish
 * protocol.
 *
 * ```
 * <lakeDir>/
 *   CURRENT                      <- pointer file holding the live buildId
 *   builds/<buildId>/            <- immutable published builds (keep last 2)
 *     matches/month=YYYY-MM/*.parquet
 *     prematch/month=YYYY-MM/*.parquet
 *     accounts/accounts.parquet
 *     manifest.json
 *   matches-recent/<matchId>.jsonl
 *   prematch-recent/<platformId>_<gameId>.jsonl
 *   competition-rank-history-recent/<competitionId>_<date>.jsonl
 * ```
 *
 * Publishing writes CURRENT.tmp then rename(2)s it over CURRENT — atomic on
 * POSIX within one filesystem. Directory renames were rejected because
 * rename(2) cannot replace a non-empty directory. Readers resolve CURRENT
 * per query; queries holding fds into a GC'd build keep working because
 * unlinked-but-open files remain readable.
 */

const CURRENT_POINTER = "CURRENT";
const BUILDS_DIR = "builds";
export const MATCHES_STAGING_DIR = "matches-recent";
export const PREMATCH_STAGING_DIR = "prematch-recent";
export const COMPETITION_RANK_HISTORY_STAGING_DIR =
  "competition-rank-history-recent";

export function resolveLakeDir(): string {
  // Widened to unknown because Bun's process-wide `mock.module` leakage can
  // hand us a PARTIAL configuration mock missing this field (see the
  // write-up in trpc/auth-web.test.ts); in real runs env-var's .default()
  // guarantees a string.
  const configured: unknown = configuration.reportLakeDir;
  const baseDir =
    typeof configured === "string"
      ? configured
      : (Bun.env["REPORT_LAKE_DIR"] ?? "./report-lake");
  // The schema is part of the storage namespace, not only a manifest check.
  // During a rolling deployment, an old worker can still publish after a new
  // worker rebuilds. Old code writes to the unnamespaced base directory while
  // this binary reads and writes only its fingerprinted directory, so those
  // workers cannot mix parquet files into the live lake.
  return path.join(baseDir, `schema-${lakeSchemaFingerprint()}`);
}

let buildCounter = 0;

/** Monotonic-enough build id: epoch-ms plus an in-process counter. */
export function newBuildId(now = new Date()): string {
  buildCounter += 1;
  return `${now.getTime().toString()}-${buildCounter.toString().padStart(4, "0")}`;
}

export function buildDirPath(lakeDir: string, buildId: string): string {
  return path.join(lakeDir, BUILDS_DIR, buildId);
}

export function matchesStagingDir(lakeDir: string): string {
  return path.join(lakeDir, MATCHES_STAGING_DIR);
}

export function prematchStagingDir(lakeDir: string): string {
  return path.join(lakeDir, PREMATCH_STAGING_DIR);
}

export function competitionRankHistoryStagingDir(lakeDir: string): string {
  return path.join(lakeDir, COMPETITION_RANK_HISTORY_STAGING_DIR);
}

/** Create the lake's top-level directories if they don't exist yet. */
export async function ensureLakeScaffold(lakeDir: string): Promise<void> {
  await mkdir(path.join(lakeDir, BUILDS_DIR), { recursive: true });
  await mkdir(matchesStagingDir(lakeDir), { recursive: true });
  await mkdir(prematchStagingDir(lakeDir), { recursive: true });
  await mkdir(competitionRankHistoryStagingDir(lakeDir), { recursive: true });
}

/**
 * Resolve the currently published build directory.
 *
 * Returns undefined when the lake has never been compacted (no CURRENT
 * pointer) — callers short-circuit to empty results. A pointer naming a
 * build directory that no longer exists is corruption (GC never deletes the
 * pointed-at build) and fails loudly; the next compaction run self-heals it.
 */
export async function readCurrentBuildDir(
  lakeDir: string,
): Promise<string | undefined> {
  const pointer = Bun.file(path.join(lakeDir, CURRENT_POINTER));
  if (!(await pointer.exists())) {
    return undefined;
  }
  const pointerText = await pointer.text();
  const buildId = pointerText.trim();
  if (buildId.length === 0) {
    throw new Error(`Report lake CURRENT pointer at ${lakeDir} is empty`);
  }
  const dir = buildDirPath(lakeDir, buildId);
  const dirEntries = await readdir(dir);
  if (dirEntries.length === 0) {
    throw new Error(
      `Report lake CURRENT pointer names empty build ${buildId} at ${lakeDir}`,
    );
  }
  return dir;
}

export async function publishBuild(
  lakeDir: string,
  buildId: string,
): Promise<void> {
  const tmpPath = path.join(lakeDir, `${CURRENT_POINTER}.tmp`);
  await Bun.write(tmpPath, `${buildId}\n`);
  await rename(tmpPath, path.join(lakeDir, CURRENT_POINTER));
}

/**
 * Delete all builds except the `keep` newest ones and, always, the build
 * CURRENT points at. Returns the number of builds removed.
 */
export async function gcOldBuilds(
  lakeDir: string,
  keep: number,
): Promise<number> {
  const buildsRoot = path.join(lakeDir, BUILDS_DIR);
  const entries = await readdir(buildsRoot, { withFileTypes: true });
  const buildIds = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    // Build ids start with epoch-ms, so numeric-aware sort = newest last.
    .toSorted((left, right) =>
      left.localeCompare(right, "en", { numeric: true }),
    );

  const pointer = Bun.file(path.join(lakeDir, CURRENT_POINTER));
  let currentBuildId: string | undefined;
  if (await pointer.exists()) {
    const pointerText = await pointer.text();
    currentBuildId = pointerText.trim();
  }

  const doomed = buildIds
    .slice(0, Math.max(0, buildIds.length - keep))
    .filter((buildId) => buildId !== currentBuildId);
  for (const buildId of doomed) {
    await rm(buildDirPath(lakeDir, buildId), { recursive: true, force: true });
  }
  return doomed.length;
}
