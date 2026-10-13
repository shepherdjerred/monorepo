import { mkdtemp, chown, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase } from "#infrastructure/database.ts";

const packageRoot = `${import.meta.dir}/../..`;
export function run(
  args: string[],
  env: Record<string, string | undefined> = {},
) {
  const result = Bun.spawnSync(args, {
    cwd: packageRoot,
    env: { ...Bun.env, ...env },
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
  const executable = args[0];
  if (executable === undefined) throw new Error("Missing Postgres executable");
  return [
    "runuser",
    "-u",
    "nobody",
    "--",
    run(["mise", "which", executable]),
    ...args.slice(1),
  ];
}

/** A private cluster per test invocation; it never connects to or stops a developer's server. */
export async function startTestPostgres() {
  const directory = await mkdtemp(path.join(tmpdir(), "tracker-pg-"));
  if (process.getuid?.() === 0) await chown(directory, 65_534, 65_534);
  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const port = probe.port;
  await probe.stop(true);
  const data = path.join(directory, "data");
  run(
    postgresCommand([
      "initdb",
      "-D",
      data,
      "-U",
      "tracker",
      "-A",
      "trust",
      "--no-locale",
      "--encoding=UTF8",
    ]),
  );
  let started = false;
  const stop = async () => {
    if (started)
      run(postgresCommand(["pg_ctl", "-D", data, "-m", "fast", "-w", "stop"]));
    await rm(directory, { recursive: true, force: true });
  };
  try {
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
    const adminUrl = `postgres://tracker@127.0.0.1:${String(port)}/postgres`;
    const admin = createDatabase(adminUrl);
    try {
      await admin.$executeRawUnsafe('CREATE DATABASE "tracker_template"');
    } finally {
      await admin.$disconnect();
    }
    const templateUrl = `postgres://tracker@127.0.0.1:${String(port)}/tracker_template`;
    run(["bun", "run", "migrate:deploy"], { DATABASE_URL: templateUrl });
    return { adminUrl, templateUrl, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export async function cloneTestDatabase(adminUrl: string) {
  const name = `tracker_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = createDatabase(adminUrl);
  await admin.$executeRawUnsafe(
    `CREATE DATABASE "${name}" TEMPLATE "tracker_template"`,
  );
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const database = createDatabase(url.toString());
  return {
    database,
    url: url.toString(),
    async close() {
      await database.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.$disconnect();
    },
  };
}
