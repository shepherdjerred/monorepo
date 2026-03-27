// eslint-disable-next-line no-restricted-imports -- Bun has no built-in fs.watch equivalent
import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { createRecallDb } from "#lib/recall/db.ts";
import { EmbeddingClient } from "#lib/recall/embeddings.ts";
import { indexFile, removeFile } from "#lib/recall/pipeline.ts";
import { reindexAll } from "#lib/recall/reindex.ts";
import { WATCHED_DIRS } from "#lib/recall/config.ts";
import { Logger } from "./logger.ts";

const DEBOUNCE_MS = 2000;

export async function runWatcher(verbose: boolean): Promise<void> {
  const logger = new Logger();
  await logger.init();

  const db = await createRecallDb();
  const embedder = new EmbeddingClient();
  const useEmbedder = (await embedder.isAvailable()) ? embedder : null;

  if (useEmbedder == null) {
    await logger.warn("watch", "mlx_unavailable", {
      message: "MLX not installed, using mock embeddings",
    });
    if (verbose) console.error("[watch] MLX not available, keyword search only");
  }

  // Initial full reindex
  if (verbose) console.error("[watch] initial reindex...");
  await logger.info("watch", "reindex_start", { type: "initial" });

  const result = await reindexAll(db, useEmbedder, false, verbose);

  await logger.info("watch", "reindex_complete", {
    scanned: result.scanned,
    indexed: result.indexed,
    skipped: result.skipped,
    removed: result.removed,
    duration_ms: Math.round(result.durationMs),
  });

  if (verbose) {
    console.error(
      `[watch] initial reindex: ${String(result.indexed)} indexed, ${String(result.skipped)} skipped in ${String(Math.round(result.durationMs))}ms`,
    );
  }

  // Set up debounced file watchers
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const handleFileChange = (filePath: string, source: string) => {
    // Clear any pending debounce for this file
    const existing = pending.get(filePath);
    if (existing != null) clearTimeout(existing);

    pending.set(
      filePath,
      setTimeout(() => {
        void (async () => {
        pending.delete(filePath);
        try {
          const exists = await stat(filePath).catch(() => null);
          if (exists == null) {
            // File deleted
            const removed = await removeFile(db, filePath, verbose);
            if (removed) {
              await logger.info("watch", "removed", { path: filePath });
              if (verbose) console.error(`[watch] removed: ${filePath}`);
            }
          } else if (filePath.endsWith(".md") || filePath.endsWith(".jsonl")) {
            // File changed — reindex
            const start = performance.now();
            const indexResult = await indexFile({
              db,
              embedder: useEmbedder,
              filePath,
              source,
              verbose,
            });
            const ms = performance.now() - start;

            if (!indexResult.skipped) {
              await logger.info("watch", "indexed", {
                path: filePath,
                chunks: indexResult.chunksCreated,
                ms: Math.round(ms),
              });
              if (verbose) {
                console.error(
                  `[watch] indexed: ${filePath} (${String(indexResult.chunksCreated)} chunks, ${String(Math.round(ms))}ms)`,
                );
              }
            }
          }
        } catch (error) {
          try {
            await logger.error("watch", "index_error", {
              path: filePath,
              error: String(error),
            });
          } catch { /* don't let logger failures crash the watcher */ }
          if (verbose) console.error(`[watch] error: ${filePath}: ${String(error)}`);
        }
        })().catch((err: unknown) => {
          console.error(`[watch] unhandled error: ${String(err)}`);
        });
      }, DEBOUNCE_MS),
    );
  };

  // Start watchers on each directory
  const watchers: ReturnType<typeof watch>[] = [];

  for (const dir of WATCHED_DIRS) {
    try {
      await stat(dir.directory);
    } catch {
      if (verbose) console.error(`[watch] skipping (not found): ${dir.directory}`);
      continue;
    }

    const watcher = watch(
      dir.directory,
      { recursive: dir.recursive },
      (_event, filename) => {
        if (filename == null) return;
        const fullPath = path.join(dir.directory, filename);

        // Apply pattern filter
        const matchesPattern = dir.patterns.some((p) => {
          if (p === "*.md") return fullPath.endsWith(".md");
          if (p === "*.jsonl") return fullPath.endsWith(".jsonl");
          return true;
        });
        if (!matchesPattern) return;

        // Apply path filter
        if (dir.pathFilter != null && !dir.pathFilter(fullPath)) return;

        handleFileChange(fullPath, dir.source);
      },
    );

    watchers.push(watcher);

    if (verbose) {
      console.error(
        `[watch] watching: ${dir.directory} (${dir.source}, recursive=${String(dir.recursive)})`,
      );
    }
  }

  await logger.info("watch", "daemon_start", {
    pid: process.pid,
    dirs: watchers.length,
  });

  console.error(
    `[watch] watching ${String(watchers.length)} directories. PID ${String(process.pid)}. Ctrl+C to stop.`,
  );

  // Handle graceful shutdown
  const shutdown = () => {
    console.error("\n[watch] shutting down...");
    for (const w of watchers) w.close();
    for (const timer of pending.values()) clearTimeout(timer);
    embedder.shutdown();
    // Best-effort log, then exit regardless
    void logger.info("watch", "daemon_stop", { pid: process.pid }).catch(() => {}).finally(() => {
      db.close();
      process.exit(0);
    });
    // Force exit after 3s if logger hangs
    setTimeout(() => { db.close(); process.exit(0); }, 3000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => { /* never resolves — keeps process alive */ });
}
