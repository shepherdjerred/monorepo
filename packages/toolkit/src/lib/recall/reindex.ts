import { stat } from "node:fs/promises";
import { Glob } from "bun";
import type { RecallDb } from "./db.ts";
import type { EmbeddingClient } from "./embeddings.ts";
import { indexFile } from "./pipeline.ts";
import { WATCHED_DIRS, type WatchedDir } from "./config.ts";

export type ReindexResult = {
  scanned: number;
  indexed: number;
  skipped: number;
  removed: number;
  errors: number;
  durationMs: number;
};

export async function reindexAll(
  db: RecallDb,
  embedder: EmbeddingClient | null,
  full = false,
  verbose = false,
): Promise<ReindexResult> {
  const start = performance.now();
  let scanned = 0;
  let indexed = 0;
  let skipped = 0;
  let errors = 0;

  const allIndexedPaths = new Set<string>();

  // First pass: collect all files to get total count for progress
  const allFiles: { path: string; source: string }[] = [];
  for (const watchedDir of WATCHED_DIRS) {
    const files = await listFiles(watchedDir);
    for (const filePath of files) {
      allFiles.push({ path: filePath, source: watchedDir.source });
    }
  }

  const total = allFiles.length;
  const startTime = performance.now();

  for (const file of allFiles) {
    scanned++;
    allIndexedPaths.add(file.path);

    // Progress indicator (overwrites line)
    if (!verbose) {
      const pct = Math.round((scanned / total) * 100);
      const elapsed = (performance.now() - startTime) / 1000;
      const rate = scanned / elapsed;
      const eta = rate > 0 ? Math.round((total - scanned) / rate) : 0;
      // Truncate filename to fit in terminal
      const basename = file.path.split("/").pop() ?? file.path;
      const name = basename.length > 40 ? basename.slice(0, 37) + "..." : basename;
      const line = `\r[reindex] ${String(scanned)}/${String(total)} (${String(pct)}%) ${String(indexed)} new, ${String(skipped)} skip | ${elapsed.toFixed(0)}s ~${String(eta)}s left | ${name}`;
      process.stderr.write(line + " ".repeat(Math.max(0, 120 - line.length)));
    }

    try {
      const result = await indexFile({
        db,
        embedder,
        filePath: file.path,
        source: file.source,
        force: full,
        verbose,
      });

      if (result.skipped) {
        skipped++;
      } else {
        indexed++;
      }
    } catch (error) {
      errors++;
      if (verbose) {
        console.error(`[reindex] error indexing ${file.path}: ${String(error)}`);
      }
    }
  }

  // Clear progress line
  if (!verbose) {
    process.stderr.write("\r" + " ".repeat(100) + "\r");
  }

  // Remove docs that no longer exist in any watched directory
  const allMetadata = db.sqlite
    .query<{ path: string }, []>("SELECT path FROM metadata")
    .all();
  let removed = 0;
  for (const row of allMetadata) {
    if (allIndexedPaths.has(row.path)) continue;

    const exists = await stat(row.path).catch(() => null);
    if (exists != null) continue;

    await db.deleteChunks(row.path);
    db.deleteFts(row.path);
    db.deleteMetadata(row.path);
    removed++;
    if (verbose) {
      console.error(`[reindex] removed stale: ${row.path}`);
    }
  }

  const durationMs = performance.now() - start;

  db.recordStat("reindex", durationMs, {
    scanned,
    indexed,
    skipped,
    removed,
    errors,
  });

  return { scanned, indexed, skipped, removed, errors, durationMs };
}

async function listFiles(watched: WatchedDir): Promise<string[]> {
  const files: string[] = [];

  try {
    await stat(watched.directory);
  } catch {
    return files; // directory doesn't exist, skip
  }

  for (const pattern of watched.patterns) {
    const globPattern = watched.recursive
      ? `**/${pattern}`
      : pattern;
    const glob = new Glob(globPattern);

    for await (const entry of glob.scan({ cwd: watched.directory, absolute: true })) {
      if (watched.pathFilter != null && !watched.pathFilter(entry)) {
        continue;
      }
      files.push(entry);
    }
  }

  return files;
}
