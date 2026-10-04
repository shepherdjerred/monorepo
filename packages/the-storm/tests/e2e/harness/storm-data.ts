import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { docker } from "./docker.ts";
import type { ServerInfo } from "./server.ts";

/**
 * Files under the server's plugins/TheStorm data folder: the SQLite database
 * and the rwf recordings. A local Docker server gives them up through `docker
 * cp`; the CI sidecar shares the folder into the workspace and names it in
 * STORM_E2E_STORM_DATA_DIR.
 */
const containerDataDir = "/data/plugins/TheStorm";

/**
 * Copies `relative` out of the server's TheStorm data folder into `outDir`
 * and returns the local path, or undefined when the server has no such file.
 */
export async function stormDataFile(
  info: ServerInfo,
  relative: string,
  outDir: string,
): Promise<string | undefined> {
  await mkdir(outDir, { recursive: true });
  const target = path.join(outDir, path.basename(relative));
  switch (info.kind) {
    case "container": {
      try {
        await docker([
          "cp",
          `${info.containerId}:${path.posix.join(containerDataDir, relative)}`,
          target,
        ]);
      } catch (error) {
        if (String(error).includes("Could not find the file")) {
          return undefined;
        }
        throw error;
      }
      return target;
    }
    case "external": {
      const shared = Bun.env["STORM_E2E_STORM_DATA_DIR"];
      if (shared === undefined) {
        throw new Error(
          "STORM_E2E_STORM_DATA_DIR must name the sidecar's shared plugins/TheStorm folder",
        );
      }
      const source = Bun.file(path.join(shared, relative));
      if (!(await source.exists())) {
        return undefined;
      }
      await Bun.write(target, source);
      return target;
    }
  }
}

/**
 * A fresh copy of the-storm.db with its WAL, so a query sees every committed
 * write. Returns the local database path.
 */
export async function copyStormDatabase(
  info: ServerInfo,
  outDir: string,
): Promise<string> {
  const database = await stormDataFile(info, "the-storm.db", outDir);
  if (database === undefined) {
    throw new Error("the server has no the-storm.db yet");
  }
  // SQLite replays the WAL into the copy when it opens; the shm is rebuilt.
  await stormDataFile(info, "the-storm.db-wal", outDir);
  return database;
}

/**
 * Runs one read-only SQL statement against a copied database in a separate
 * Bun process, so the suite needs no SQLite driver of its own. Rows come back
 * as JSON objects.
 */
export async function querySqlite(
  database: string,
  sql: string,
): Promise<unknown[]> {
  // The file and statement travel in the environment: `bun -e` does not pass
  // trailing arguments through to Bun.argv.
  const script = [
    'import { Database } from "bun:sqlite";',
    'const db = new Database(Bun.env["STORM_E2E_SQLITE_FILE"] ?? "");',
    'console.log(JSON.stringify(db.query(Bun.env["STORM_E2E_SQL"] ?? "").all()));',
    "db.close();",
  ].join("\n");
  const subprocess = Bun.spawn(["bun", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, STORM_E2E_SQLITE_FILE: database, STORM_E2E_SQL: sql },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`sqlite query failed (${exitCode.toString()}): ${stderr}`);
  }
  return z.array(z.unknown()).parse(JSON.parse(stdout));
}
