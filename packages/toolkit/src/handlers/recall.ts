import { parseArgs } from "node:util";
import { createRecallDb, type RecallDb } from "#lib/recall/db.ts";
import { EmbeddingClient } from "#lib/recall/embeddings.ts";
import { hybridSearch } from "#lib/recall/search.ts";
import { indexFile, removeFile } from "#lib/recall/pipeline.ts";
import { reindexAll } from "#lib/recall/reindex.ts";
import { runWatcher } from "#daemon/watch.ts";
import { daemonStart, daemonStop, daemonStatus } from "#daemon/daemon.ts";
import { viewLogs } from "#daemon/logs.ts";
import { runDebug } from "#daemon/debug.ts";

export async function handleRecallCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  if (
    subcommand == null ||
    subcommand === "--help" ||
    subcommand === "-h"
  ) {
    printRecallUsage();
    process.exit(0);
  }

  switch (subcommand) {
    case "search":
      await handleSearch(args);
      break;
    case "add":
      await handleAdd(args);
      break;
    case "remove":
      await handleRemove(args);
      break;
    case "reindex":
      await handleReindex(args);
      break;
    case "status":
      await handleStatus(args);
      break;
    case "debug":
      await runDebug();
      break;
    case "logs":
      await handleLogs(args);
      break;
    case "daemon":
      await handleDaemon(args);
      break;
    case "watch":
      await handleWatch(args);
      break;
    default:
      console.error(`Unknown recall subcommand: ${subcommand}`);
      printRecallUsage();
      process.exit(1);
  }
}

async function handleSearch(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      limit: { type: "string", default: "10" },
      mode: { type: "string", default: "hybrid" },
      verbose: { type: "boolean", short: "v", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const query = positionals.join(" ");
  if (query.trim().length === 0) {
    console.error("Usage: toolkit recall search <query>");
    process.exit(1);
  }

  const db = await createRecallDb();
  const embedder = new EmbeddingClient();
  const useEmbedder = await embedder.isAvailable() ? embedder : null;

  if (useEmbedder == null && values.verbose) {
    console.error("[search] MLX not available, using keyword-only search");
  }

  const modeStr = values.mode;
  const mode: "hybrid" | "semantic" | "keyword" =
    modeStr === "semantic" || modeStr === "keyword" ? modeStr : "hybrid";
  const results = await hybridSearch(db, useEmbedder, {
    query,
    limit: Number.parseInt(values.limit, 10),
    mode: useEmbedder == null ? "keyword" : mode,
    verbose: values.verbose,
  });

  if (values.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    if (results.length === 0) {
      console.log("No results found.");
    } else {
      for (const [i, result] of results.entries()) {
        console.log(
          `${String(i + 1)}. ${result.path} (${result.source}, score: ${result.score.toFixed(3)})`,
        );
        console.log(`   ${result.title}`);
        const preview = result.chunk.slice(0, 200).replaceAll("\n", " ");
        console.log(`   ${preview}...`);
        console.log();
      }
    }
  }

  embedder.shutdown();
  db.close();
}

async function handleAdd(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      tags: { type: "string" },
      source: { type: "string", default: "user" },
      verbose: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
  });

  if (positionals.length === 0) {
    console.error("Usage: toolkit recall add <path> [--tags t1,t2] [--source name]");
    process.exit(1);
  }

  const db = await createRecallDb();
  const embedder = new EmbeddingClient();
  const useEmbedder = (await embedder.isAvailable()) ? embedder : null;
  const tags = values.tags?.split(",") ?? [];

  for (const filePath of positionals) {
    const result = await indexFile({
      db,
      embedder: useEmbedder,
      filePath,
      source: values.source,
      tags,
      verbose: values.verbose,
    });

    if (result.skipped) {
      console.log(`Skipped (unchanged): ${result.path}`);
    } else {
      console.log(
        `Indexed: ${result.path} (${String(result.chunksCreated)} chunks, ${String(Math.round(result.durationMs))}ms)`,
      );
    }
  }

  embedder.shutdown();
  db.close();
}

async function handleRemove(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      verbose: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
  });

  if (positionals.length === 0) {
    console.error("Usage: toolkit recall remove <path>");
    process.exit(1);
  }

  const db = await createRecallDb();

  for (const filePath of positionals) {
    const removed = await removeFile(db, filePath, values.verbose);
    if (removed) {
      console.log(`Removed: ${filePath}`);
    } else {
      console.log(`Not found in index: ${filePath}`);
    }
  }

  db.close();
}

async function handleReindex(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      full: { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
  });

  const db = await createRecallDb();
  const embedder = new EmbeddingClient();
  const useEmbedder = (await embedder.isAvailable()) ? embedder : null;

  if (useEmbedder == null) {
    console.error("Warning: MLX not available. Indexing with mock embeddings (keyword search only).");
  }

  const result = await reindexAll(
    db,
    useEmbedder,
    values.full,
    values.verbose,
  );

  console.log(`Reindex complete:`);
  console.log(`  Scanned:  ${String(result.scanned)}`);
  console.log(`  Indexed:  ${String(result.indexed)}`);
  console.log(`  Skipped:  ${String(result.skipped)} (unchanged)`);
  console.log(`  Removed:  ${String(result.removed)} (stale)`);
  if (result.errors > 0) {
    console.log(`  Errors:   ${String(result.errors)}`);
  }
  console.log(`  Duration: ${String(Math.round(result.durationMs))}ms`);

  embedder.shutdown();
  db.close();
}

async function handleStatus(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      perf: { type: "boolean", default: false },
      db: { type: "boolean", default: false },
      sources: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const db = await createRecallDb();

  const docCount = db.getDocCount();
  const chunkCount = db.getChunkCount();
  const sourceStats = db.getSourceStats();
  const embedder = new EmbeddingClient();
  const mlxAvailable = await embedder.isAvailable();

  if (values.json) {
    console.log(JSON.stringify({
      documents: docCount,
      chunks: chunkCount,
      sources: sourceStats,
      embeddings: { available: mlxAvailable, model: mlxAvailable ? "bge-m3" : null, dim: 1024 },
    }, null, 2));
    db.close();
    return;
  }

  // Index overview
  console.log("Recall Index Status");
  console.log(`  Documents: ${String(docCount)}`);
  console.log(`  Chunks:    ${String(chunkCount)}`);

  // DB size
  const { stat: fsStat } = await import("node:fs/promises");
  const dbStat = await fsStat(db.sqlite.filename).catch(() => null);
  if (dbStat != null) {
    console.log(`  DB size:   ${(dbStat.size / 1024 / 1024).toFixed(1)} MB`);
  }
  console.log();

  // Sources
  if (sourceStats.length > 0) {
    console.log("Sources");
    for (const s of sourceStats) {
      console.log(
        `  ${s.source.padEnd(20)} ${String(s.docs).padStart(4)} docs  (${String(s.chunks)} chunks)`,
      );
    }
    console.log();
  }

  // Embeddings
  console.log("Embeddings");
  if (mlxAvailable) {
    console.log("  Model:  bge-m3 (1024-dim)");
    console.log("  Status: available");
  } else {
    console.log("  Status: not available (keyword search only)");
    console.log("  Install: pip install mlx-embedding-models");
  }
  console.log();

  // Performance stats (if --perf)
  if (values.perf) {
    printPerfStats(db);
  }

  db.close();
}

async function handleWatch(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      verbose: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
  });
  await runWatcher(values.verbose);
}

async function handleDaemon(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      verbose: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
  });

  const action = positionals[0] as string | undefined;
  switch (action) {
    case "start":
      await daemonStart(values.verbose);
      break;
    case "stop":
      await daemonStop(values.verbose);
      break;
    case "status":
      await daemonStatus(values.verbose);
      break;
    case undefined:
    default:
      console.error("Usage: toolkit recall daemon start|stop|status");
      process.exit(1);
  }
}

async function handleLogs(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      follow: { type: "boolean", short: "f", default: false },
      level: { type: "string" },
      since: { type: "string" },
      json: { type: "boolean", default: false },
      limit: { type: "string", default: "50" },
    },
    allowPositionals: true,
  });

  await viewLogs({
    follow: values.follow,
    level: values.level,
    since: values.since,
    json: values.json,
    limit: Number.parseInt(values.limit, 10),
  });
}

function printPerfStats(db: RecallDb): void {
  const searchStats = db.sqlite
    .query<{ duration_ms: number; details: string }, []>(
      "SELECT duration_ms, details FROM stats WHERE event = 'search' ORDER BY ts DESC LIMIT 100",
    )
    .all();

  if (searchStats.length > 0) {
    const durations = searchStats.map((s) => s.duration_ms).toSorted((a, b) => a - b);
    console.log(`Search Performance (last ${String(searchStats.length)} queries)`);
    console.log(`  Avg:  ${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1)} ms`);
    console.log(`  p50:  ${String(durations[Math.floor(durations.length * 0.5)]?.toFixed(1))} ms`);
    console.log(`  p90:  ${String(durations[Math.floor(durations.length * 0.9)]?.toFixed(1))} ms`);
    console.log(`  p99:  ${String(durations[Math.floor(durations.length * 0.99)]?.toFixed(1))} ms`);
    console.log();
  }

  const indexStats = db.sqlite
    .query<{ duration_ms: number }, []>(
      "SELECT duration_ms FROM stats WHERE event = 'index' ORDER BY ts DESC LIMIT 100",
    )
    .all();

  if (indexStats.length > 0) {
    const durations = indexStats.map((s) => s.duration_ms).toSorted((a, b) => a - b);
    console.log(`Indexing Performance (last ${String(indexStats.length)} files)`);
    console.log(`  Avg:  ${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1)} ms/file`);
    console.log(`  p50:  ${String(durations[Math.floor(durations.length * 0.5)]?.toFixed(1))} ms`);
    console.log(`  p90:  ${String(durations[Math.floor(durations.length * 0.9)]?.toFixed(1))} ms`);
    console.log();
  }

  const reindexStats = db.sqlite
    .query<{ duration_ms: number; details: string }, []>(
      "SELECT duration_ms, details FROM stats WHERE event = 'reindex' ORDER BY ts DESC LIMIT 5",
    )
    .all();

  if (reindexStats.length > 0) {
    console.log(`Recent Reindexes`);
    for (const r of reindexStats) {
      const details = JSON.parse(r.details) as Record<string, unknown>;
      console.log(
        `  ${String(Math.round(r.duration_ms))}ms — ${String(details["scanned"] ?? 0)} scanned, ${String(details["indexed"] ?? 0)} indexed, ${String(details["skipped"] ?? 0)} skipped`,
      );
    }
    console.log();
  }
}

function printRecallUsage(): void {
  console.log(`
toolkit recall - Local RAG search across plans, research, memories, and fetched pages

Usage:
  toolkit recall <subcommand> [options]

Subcommands:
  search <query>       Hybrid semantic + keyword search
  add <path>           Index file(s) or directory
  remove <path>        Remove from index
  reindex [--full]     Re-scan all watched directories
  status [--perf]      Index stats, daemon health, performance
  debug                Full diagnostic check
  logs [--follow]      View structured logs
  daemon start|stop    Manage background watcher
  watch                Run watcher in foreground

Options:
  --verbose, -v        Show detailed output
  --json               Machine-readable JSON output

Examples:
  toolkit recall search "vector database"
  toolkit recall add ~/Documents/notes/
  toolkit recall reindex --full
  toolkit recall status --perf
  toolkit recall logs --follow
`);
}
