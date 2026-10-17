import { mkdtemp, chown, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase } from "#infrastructure/database.ts";

const packageRoot = `${import.meta.dir}/../..`;
function run(
  args: string[],
  environment: Record<string, string | undefined> = {},
) {
  const result = Bun.spawnSync(args, {
    cwd: packageRoot,
    env: { ...Bun.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(
      `${args[0] ?? "Command"} failed: ${result.stderr.toString()}`,
    );
  return result.stdout.toString().trim();
}
function postgresCommand(args: string[]): string[] {
  if (process.getuid?.() !== 0) return args;
  const command = args[0];
  if (command === undefined) throw new Error("PostgreSQL command missing");
  return [
    "runuser",
    "-u",
    "nobody",
    "--",
    run(["mise", "which", command]),
    ...args.slice(1),
  ];
}

/** Private short-lived PostgreSQL cluster; no developer or production database access. */
export async function startMediaTestPostgres() {
  const directory = await mkdtemp(path.join(tmpdir(), "media-pg-"));
  if (process.getuid?.() === 0) await chown(directory, 65_534, 65_534);
  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const port = probe.port;
  await probe.stop(true);
  const data = path.join(directory, "data");
  let started = false;
  const stop = async () => {
    if (started)
      run(postgresCommand(["pg_ctl", "-D", data, "-m", "fast", "-w", "stop"]));
    await rm(directory, { recursive: true, force: true });
  };
  try {
    run(
      postgresCommand([
        "initdb",
        "-D",
        data,
        "-U",
        "media",
        "-A",
        "trust",
        "--no-locale",
        "--encoding=UTF8",
      ]),
    );
    run(
      postgresCommand([
        "pg_ctl",
        "-D",
        data,
        "-l",
        path.join(directory, "server.log"),
        "-o",
        `-h 127.0.0.1 -p ${String(port)} -k ${directory}`,
        "-w",
        "start",
      ]),
    );
    started = true;
    const url = `postgres://media@127.0.0.1:${String(port)}/postgres`;
    run(["bun", "run", "migrate:deploy"], { DATABASE_URL: url });
    const database = createDatabase(url);
    return {
      database,
      url,
      async close() {
        await database.$disconnect();
        await stop();
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
