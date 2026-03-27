import { stat } from "node:fs/promises";
import path from "node:path";
import { Glob } from "bun";
import { LANCE_DIR, SQLITE_PATH, LOGS_DIR, WATCHED_DIRS } from "#lib/recall/config.ts";
import { EmbeddingClient } from "#lib/recall/embeddings.ts";
import { Logger } from "./logger.ts";

type CheckFn = (pass: boolean, msg: string) => void;

async function checkDatabase(check: CheckFn): Promise<void> {
  console.log("Database");
  const dbStat = await stat(SQLITE_PATH).catch(() => null);
  if (dbStat == null) {
    check(false, `${SQLITE_PATH} not found`);
  } else {
    check(true, `${SQLITE_PATH} exists (${formatBytes(dbStat.size)})`);
  }

  const lanceStat = await stat(LANCE_DIR).catch(() => null);
  if (lanceStat == null) {
    check(false, `LanceDB directory not found at ${LANCE_DIR}`);
  } else {
    check(true, `LanceDB directory exists at ${LANCE_DIR}`);
  }

  if (dbStat != null) {
    try {
      const { Database } = await import("bun:sqlite");
      const db = new Database(SQLITE_PATH, { readonly: true });
      const docCount =
        db
          .query<{ c: number }, []>("SELECT COUNT(*) as c FROM metadata")
          .get()?.c ?? 0;
      const chunkCount =
        db
          .query<{ c: number }, []>(
            "SELECT COALESCE(SUM(chunk_count), 0) as c FROM metadata",
          )
          .get()?.c ?? 0;
      check(true, `metadata table: ${String(docCount)} documents`);
      check(true, `total chunks: ${String(chunkCount)}`);

      const ftsCount =
        db
          .query<{ c: number }, []>("SELECT COUNT(*) as c FROM docs_fts")
          .get()?.c ?? 0;
      check(true, `FTS5 table: ${String(ftsCount)} rows`);

      db.close();
    } catch (error) {
      check(false, `SQLite error: ${String(error)}`);
    }
  }
}

async function checkEmbeddings(check: CheckFn): Promise<void> {
  console.log("Embeddings");
  const embedder = new EmbeddingClient();
  const mlxAvailable = await embedder.isAvailable();
  if (mlxAvailable) {
    check(true, "mlx-embedding-models installed");
    try {
      const start = performance.now();
      await embedder.ensureStarted();
      const vectors = await embedder.embed(["hello world"]);
      const ms = performance.now() - start;
      check(
        true,
        `test embed: ${String(vectors[0]?.length ?? 0)}-dim in ${String(Math.round(ms))}ms`,
      );
    } catch (error) {
      check(false, `embed test failed: ${String(error)}`);
    }
    embedder.shutdown();
  } else {
    check(false, "mlx-embedding-models not installed (keyword search only)");
    console.log("     Install with: pip install mlx-embedding-models");
  }

  const pythonProc = Bun.spawn(["python3", "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const pythonVersionRaw = await new Response(pythonProc.stdout).text();
  const pythonVersion = pythonVersionRaw.trim();
  await pythonProc.exited;
  if (pythonProc.exitCode === 0) {
    check(true, `Python: ${pythonVersion}`);
  } else {
    check(false, "python3 not found");
  }
}

async function checkWatchedDirs(check: CheckFn): Promise<void> {
  console.log("Watched Directories");
  for (const dir of WATCHED_DIRS) {
    const dirExists = await stat(dir.directory).catch(() => null);
    if (dirExists == null) {
      check(false, `${dir.directory} (${dir.source}) — not found`);
      continue;
    }

    let count = 0;
    for (const pattern of dir.patterns) {
      const globPattern = dir.recursive ? `**/${pattern}` : pattern;
      const glob = new Glob(globPattern);
      for await (const entry of glob.scan({ cwd: dir.directory, absolute: true })) {
        if (dir.pathFilter != null && !dir.pathFilter(entry)) continue;
        count++;
      }
    }

    check(true, `${dir.directory} (${dir.source}) — ${String(count)} files`);
  }
}

async function checkFetchEngines(check: CheckFn): Promise<void> {
  console.log("Fetch Engines");
  for (const [name, cmd] of [
    ["lightpanda", "lightpanda"],
    ["pinchtab", "pinchtab"],
  ] as const) {
    const proc = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "pipe" });
    const whichResponse = await new Response(proc.stdout).text();
    const whichPath = whichResponse.trim();
    await proc.exited;
    if (proc.exitCode === 0) {
      check(true, `${name} found at ${whichPath}`);
    } else {
      check(false, `${name} not found in PATH`);
    }
  }
}

async function checkDaemonAndLogs(check: CheckFn): Promise<void> {
  console.log("Daemon");
  const plistPath = path.join(
    Bun.env["HOME"] ?? "~",
    "Library",
    "LaunchAgents",
    "com.shepherdjerred.toolkit-recall.plist",
  );
  const plistExists = await stat(plistPath).catch(() => null);
  check(plistExists != null, `launchctl plist ${plistExists == null ? "not installed" : "installed"}`);

  const daemonProc = Bun.spawn(
    ["launchctl", "list", "com.shepherdjerred.toolkit-recall"],
    { stdout: "pipe", stderr: "pipe" },
  );
  await daemonProc.exited;
  check(daemonProc.exitCode === 0, `daemon ${daemonProc.exitCode === 0 ? "running" : "not running"}`);

  console.log();

  console.log("Logs");
  const logger = new Logger();
  const logFiles = await logger.getLogFiles();
  if (logFiles.length > 0) {
    const latest = logFiles[0];
    if (latest == null) {
      check(false, "log file array is unexpectedly empty");
      return;
    }
    check(true, `${latest.name} (${formatBytes(latest.size)})`);

    try {
      const { readFile: rf } = await import("node:fs/promises");
      const content = await rf(path.join(LOGS_DIR, latest.name), "utf8");
      const errorCount = content
        .split("\n")
        .filter((line) => line.includes('"level":"error"')).length;
      check(
        errorCount === 0,
        `${String(errorCount)} errors in ${latest.name}`,
      );
    } catch {
      // ignore
    }
  } else {
    check(false, "no log files found");
  }
}

export async function runDebug(): Promise<void> {
  let failures = 0;
  const check: CheckFn = (pass: boolean, msg: string): void => {
    const icon = pass ? "\u2705" : "\u274C";
    console.log(`  ${icon} ${msg}`);
    if (!pass) failures++;
  };

  await checkDatabase(check);
  console.log();

  await checkEmbeddings(check);
  console.log();

  await checkWatchedDirs(check);
  console.log();

  await checkFetchEngines(check);
  console.log();

  await checkDaemonAndLogs(check);

  console.log();
  console.log(failures === 0 ? "All checks passed." : `${String(failures)} check(s) failed.`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
