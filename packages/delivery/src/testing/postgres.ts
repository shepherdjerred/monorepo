import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { createDatabase } from "#infrastructure/database.ts";
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

/** Disposable cluster, unique data directory and port; never uses a production URL. */
export async function createTestDatabase() {
  const root = await mkdtemp(path.join(tmpdir(), "delivery-pg-"));
  const directory = path.join(root, "data");
  const port = await availablePort();
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
  try {
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    const files = [
      ...new Bun.Glob("*/migration.sql").scanSync({
        cwd: migrations.pathname,
        onlyFiles: true,
      }),
    ].sort();
    if (files.length === 0)
      throw new Error("Delivery database migrations are missing");
    for (const file of files) {
      await run([
        "psql",
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        "--dbname",
        url,
        "--file",
        new URL(file, migrations).pathname,
      ]);
    }
  } catch (error) {
    await database.$disconnect();
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
    await rm(root, { recursive: true });
    throw error;
  }
  return {
    database,
    url,
    close: async () => {
      await database.$disconnect();
      await run(
        await postgresOwner([
          "pg_ctl",
          "-D",
          directory,
          "-m",
          "fast",
          "-w",
          "stop",
        ]),
      );
      await rm(root, { recursive: true });
    },
  };
}
