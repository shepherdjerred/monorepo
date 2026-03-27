// eslint-disable-next-line no-restricted-imports -- Bun has no built-in fs.watch equivalent
import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { createRecallDb } from "#lib/recall/db.ts";
import { EmbeddingClient } from "#lib/recall/embeddings.ts";
import { indexFile, removeFile } from "#lib/recall/pipeline.ts";
import { reindexAll } from "#lib/recall/reindex.ts";
import { WATCHED_DIRS } from "#lib/recall/config.ts";
import type { RecallDb } from "#lib/recall/db.ts";
import { Logger } from "./logger.ts";

const DEBOUNCE_MS = 2000;

type QueueItem = { filePath: string; source: string };

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

  // Serial write queue — LanceDB doesn't support concurrent writers
  const writeQueue: QueueItem[] = [];
  let processing = false;

  async function processQueue(): Promise<void> {
    if (processing) return;
    processing = true;

    while (writeQueue.length > 0) {
      const item = writeQueue.shift();
      if (item == null) break;
      await processItem(item, { db, embedder: useEmbedder, logger, verbose });
    }

    processing = false;
  }

  // Set up debounced file watchers
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const handleFileChange = (filePath: string, source: string) => {
    const existing = pending.get(filePath);
    if (existing != null) clearTimeout(existing);

    pending.set(
      filePath,
      setTimeout(() => {
        pending.delete(filePath);
        // Deduplicate: don't queue if already in the queue
        if (!writeQueue.some((item) => item.filePath === filePath)) {
          writeQueue.push({ filePath, source });
        }
        void processQueue();
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

        const matchesPattern = dir.patterns.some((p) => {
          if (p === "*.md") return fullPath.endsWith(".md");
          if (p === "*.jsonl") return fullPath.endsWith(".jsonl");
          return true;
        });
        if (!matchesPattern) return;

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
    writeQueue.length = 0;
    embedder.shutdown();
    void (async () => {
      try {
        await logger.info("watch", "daemon_stop", { pid: process.pid });
      } catch {
        // ignore logger failures during shutdown
      } finally {
        db.close();
        process.exit(0);
      }
    })();
    setTimeout(() => { db.close(); process.exit(0); }, 3000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise(() => { /* never resolves — keeps process alive */ });
}

async function processItem(
  item: QueueItem,
  deps: { db: RecallDb; embedder: EmbeddingClient | null; logger: Logger; verbose: boolean },
): Promise<void> {
  const { db, embedder, logger, verbose } = deps;
  try {
    const exists = await stat(item.filePath).catch(() => null);
    if (exists == null) {
      const removed = await removeFile(db, item.filePath, verbose);
      if (removed) {
        await logger.info("watch", "removed", { path: item.filePath });
        if (verbose) console.error(`[watch] removed: ${item.filePath}`);
      }
    } else if (item.filePath.endsWith(".md") || item.filePath.endsWith(".jsonl")) {
      const start = performance.now();
      const indexResult = await indexFile({
        db,
        embedder,
        filePath: item.filePath,
        source: item.source,
        verbose,
      });
      const ms = performance.now() - start;

      if (!indexResult.skipped) {
        await logger.info("watch", "indexed", {
          path: item.filePath,
          chunks: indexResult.chunksCreated,
          ms: Math.round(ms),
        });
        if (verbose) {
          console.error(
            `[watch] indexed: ${item.filePath} (${String(indexResult.chunksCreated)} chunks, ${String(Math.round(ms))}ms)`,
          );
        }
      }
    }
  } catch (error) {
    try {
      await logger.error("watch", "index_error", {
        path: item.filePath,
        error: String(error),
      });
    } catch { /* don't let logger failures crash the watcher */ }
    if (verbose) console.error(`[watch] error: ${item.filePath}: ${String(error)}`);
  }
}
