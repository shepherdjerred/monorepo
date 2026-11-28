import path from "node:path";

const packageRoot = path.join(import.meta.dirname, "..");

async function run(
  command: readonly string[],
  env: Record<string, string> = {},
) {
  const proc = Bun.spawn([...command], {
    cwd: packageRoot,
    env: { ...Bun.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} exited ${String(exitCode)}: ${stderr === "" ? stdout : stderr}`,
    );
  }
  return stdout;
}

/**
 * A throwaway PostgreSQL for the image smoke, listening only on a Unix
 * socket inside `root` so concurrent smoke stages cannot collide.
 */
export async function startSmokePostgres(root: string): Promise<{
  readonly databaseUrl: string;
  readonly stop: () => Promise<void>;
}> {
  const pgConfig = await run(["pg_config", "--bindir"]);
  const binDir = pgConfig.trim();
  const dataDir = path.join(root, "pg");
  await run([
    path.join(binDir, "initdb"),
    "-D",
    dataDir,
    "-U",
    "postgres",
    "--auth=trust",
    "--no-locale",
    "--encoding=UTF8",
  ]);
  await run([
    path.join(binDir, "pg_ctl"),
    "-D",
    dataDir,
    "-w",
    "-t",
    "30",
    "-l",
    path.join(root, "pg.log"),
    "-o",
    `-c listen_addresses= -c unix_socket_directories=${root}`,
    "start",
  ]);
  return {
    databaseUrl: `postgres://postgres@localhost/postgres?host=${root}`,
    stop: async () => {
      await run([
        path.join(binDir, "pg_ctl"),
        "-D",
        dataDir,
        "-m",
        "fast",
        "stop",
      ]);
    },
  };
}

export async function runPackageCommand(
  command: readonly string[],
  env: Record<string, string>,
): Promise<string> {
  return await run(command, env);
}
