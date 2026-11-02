import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { createDatabase } from "#infrastructure/database.ts";
import { registerTestServices } from "./services.ts";
import { z } from "zod";

async function availablePort() {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  if (address === null || typeof address === "string")
    throw new Error("Cannot allocate PostgreSQL port");
  await new Promise<void>((resolve, reject) => {
    listener.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
  return address.port;
}

async function run(argv: string[], env?: Record<string, string>) {
  const inherited = z
    .record(z.string(), z.string())
    .parse(
      Object.fromEntries(
        Object.entries(Bun.env).filter(
          (entry) =>
            typeof entry[1] === "string" &&
            entry[0] !== "OP_SERVICE_ACCOUNT_TOKEN",
        ),
      ),
    );
  const child = Bun.spawn(argv, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...inherited, ...env },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0)
    throw new Error(`${argv[0] ?? "Command"} failed: ${stderr}`);
  return stdout;
}

async function postgresOwner(argv: string[]) {
  if (process.getuid?.() !== 0) return argv;
  const executable = argv[0];
  if (executable === undefined) throw new Error("PostgreSQL command is empty");
  const selected = await run(["mise", "which", executable]);
  const resolved = selected.trim();
  const quoted = [resolved, ...argv.slice(1)]
    .map((value) => `'${value.replaceAll("'", String.raw`'\''`)}'`)
    .join(" ");
  return ["su", "-s", "/bin/sh", "nobody", "-c", quoted];
}

const migrationsRoot = new URL("../../prisma/migrations/", import.meta.url);

/**
 * A cluster whose owner process is gone still holds a System V shared-memory
 * slot. The same process is never an orphan, even before it has written a
 * pid, so a parallel create in this process is left alone once the pid file
 * exists. A missing pid is a cluster leaked by an older build.
 */
export function isOrphanedTestCluster(
  ownerPid: number | null,
  selfPid: number,
  alive: (pid: number) => boolean,
): boolean {
  return ownerPid === null || (ownerPid !== selfPid && !alive(ownerPid));
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    return code === "EPERM";
  }
}

async function readOwnerPid(cluster: string): Promise<number | null> {
  const text = await Bun.file(path.join(cluster, "owner.pid"))
    .text()
    .catch(() => "");
  const parsed = Number(text.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function stopCluster(directory: string): Promise<void> {
  try {
    await run(
      await postgresOwner([
        "pg_ctl",
        "-D",
        directory,
        "-m",
        "immediate",
        "-w",
        "stop",
      ]),
    );
  } catch {
    // initdb never finished, or the server is already gone.
  }
}

async function reapOrphanedTestClusters(): Promise<void> {
  const entries = await readdir(tmpdir(), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("delivery-pg-"))
      continue;
    const cluster = path.join(tmpdir(), entry.name);
    const ownerPid = await readOwnerPid(cluster);
    if (!isOrphanedTestCluster(ownerPid, process.pid, pidAlive)) continue;
    await stopCluster(path.join(cluster, "data"));
    await rm(cluster, { recursive: true, force: true });
  }
}

function writeOwnerPid(root: string): void {
  const file = path.join(root, "owner.pid");
  const written = Bun.spawnSync(["tee", file], {
    stdin: Buffer.from(`${String(process.pid)}\n`),
    stdout: "ignore",
    stderr: "pipe",
  });
  if (written.exitCode !== 0) {
    throw new Error(
      `could not record the test Postgres owner: ${written.stderr.toString()}`,
    );
  }
}

/** Committed migration directories in application order. */
export function migrationNames() {
  const names = [
    ...new Bun.Glob("*/migration.sql").scanSync({
      cwd: migrationsRoot.pathname,
      onlyFiles: true,
    }),
  ]
    .map((file) => path.dirname(file))
    .sort();
  if (names.length === 0)
    throw new Error("Delivery database migrations are missing");
  return names;
}

/**
 * Disposable cluster, unique data directory and port; never uses a production
 * URL. `through` stops after the named migration so a test can seed rows in
 * that schema and apply the rest with `migrate()`.
 */
export async function createTestDatabase(options: { through?: string } = {}) {
  const names = migrationNames();
  if (options.through !== undefined && !names.includes(options.through))
    throw new Error(`Unknown Delivery migration ${options.through}`);
  await reapOrphanedTestClusters();
  const root = await mkdtemp(path.join(tmpdir(), "delivery-pg-"));
  // Before any await, so a concurrent create does not treat this directory
  // as a pid-less leak. spawnSync blocks the event loop for the write.
  writeOwnerPid(root);
  const directory = path.join(root, "data");
  const port = await availablePort();
  try {
    if (process.getuid?.() === 0) await run(["chown", "nobody", root]);
    await run(
      await postgresOwner([
        "initdb",
        "-D",
        directory,
        "-U",
        "delivery",
        "--auth=trust",
        "--encoding=UTF8",
        "--no-locale",
      ]),
    );
    await run(
      await postgresOwner([
        "pg_ctl",
        "-D",
        directory,
        "-w",
        "-t",
        "30",
        "-l",
        path.join(root, "server.log"),
        "-o",
        `-p ${String(port)} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c fsync=off -c synchronous_commit=off`,
        "start",
      ]),
    );
    const url = `postgres://delivery@127.0.0.1:${String(port)}/postgres`;
    const database = createDatabase(url);
    const applied = new Set<string>();
    async function migrate(through?: string) {
      if (through !== undefined && !names.includes(through))
        throw new Error(`Unknown Delivery migration ${through}`);
      for (const name of names) {
        if (applied.has(name)) continue;
        if (through !== undefined && name > through) break;
        await run([
          "psql",
          "--no-psqlrc",
          "--set=ON_ERROR_STOP=1",
          "--dbname",
          url,
          "--file",
          new URL(`${name}/migration.sql`, migrationsRoot).pathname,
        ]);
        applied.add(name);
      }
    }
    const close = async () => {
      await database.$disconnect();
      await run(
        await postgresOwner([
          "pg_ctl",
          "-D",
          directory,
          "-m",
          applied.size === names.length ? "fast" : "immediate",
          "-w",
          "stop",
        ]),
      );
      await rm(root, { recursive: true });
    };
    try {
      await migrate(options.through);
      // A fully migrated cluster starts with the catalog's services registered,
      // as after a reconcile; a partial one is a migration test's v1 record.
      if (options.through === undefined) await registerTestServices(database);
    } catch (error) {
      await close();
      throw error;
    }
    return {
      database,
      url,
      /** Apply the remaining committed migrations, optionally stopping after one. */
      migrate,
      /** Names applied so far, in order. */
      get applied() {
        return names.filter((name) => applied.has(name));
      },
      close,
    };
  } catch (error) {
    await stopCluster(directory);
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
