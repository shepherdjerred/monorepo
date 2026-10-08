import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
const source = z
  .string()
  .regex(/^storm-forum-test-[a-f0-9]{8}-app$/)
  .parse(Bun.argv[2]);
const root = path.resolve(import.meta.dirname, "..");
const inspect = Bun.spawn(["docker", "inspect", source], {
  stdout: "pipe",
  stderr: "ignore",
});
const metadata = z
  .array(
    z.object({
      Config: z.object({ Env: z.array(z.string()) }),
      NetworkSettings: z.object({
        Networks: z.record(z.string(), z.unknown()),
      }),
    }),
  )
  .length(1)
  .parse(JSON.parse(await new Response(inspect.stdout).text()));
if ((await inspect.exited) !== 0) {
  throw new Error("Source integration container is unavailable");
}
const entry = metadata[0];
if (entry === undefined) {
  throw new Error("Source metadata missing");
}
const sourceEnv = Object.fromEntries(
  entry.Config.Env.map((item) => {
    const separator = item.indexOf("=");
    return [item.slice(0, separator), item.slice(separator + 1)];
  }),
);
const network = Object.keys(entry.NetworkSettings.Networks)[0];
if (network === undefined || !/^storm-forum-test-[a-f0-9]{8}$/.test(network)) {
  throw new Error("Expected an isolated integration network");
}
const suffix = randomBytes(4).toString("hex");
const database = `storm-forum-restore-${suffix}-db`;
const target = `storm-forum-restore-${suffix}-app`;
const fixture = `storm-forum-restore-${suffix}-s3`;
const env = {
  ...Bun.env,
  ...sourceEnv,
  STORM_FORUM_STAGE: "beta",
  BACKUP_ENDPOINT: `http://${fixture}:19001`,
  BACKUP_BUCKET: "roundtrip",
  BACKUP_ACCESS_KEY: "local-fixture",
  BACKUP_SECRET_KEY: randomBytes(32).toString("hex"),
  BUNDLE_SHA256: "a".repeat(64),
  MARIADB_ROOT_PASSWORD: randomBytes(32).toString("hex"),
};
const run = async (argv: string[], overrides: Record<string, string> = {}) => {
  const child = Bun.spawn(["docker", ...argv], {
    env: { ...env, ...overrides },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, error, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (
    status !== 0 ||
    /An unexpected error occurred|An exception occurred:|Fatal error:/.test(
      output,
    )
  ) {
    let diagnostic = output + error;
    for (const [key, value] of Object.entries({ ...env, ...overrides })) {
      if (/PASSWORD|SECRET|TOKEN|ACCESS_KEY/.test(key) && value.length > 0) {
        diagnostic = diagnostic.replaceAll(value, "<redacted>");
      }
    }
    throw new Error(
      `Local restore fixture operation failed: ${argv[0] ?? "unknown"}: ${diagnostic}`,
    );
  }
  return output;
};
const bootstrap = Object.keys(env).flatMap((key) =>
  /^(?:DB_|ADMIN_|FORUM_URL|POSTAL_|TURNSTILE_|BACKUP_|BUNDLE_SHA256|STORM_FORUM_STAGE)/.test(
    key,
  )
    ? ["-e", key]
    : [],
);
try {
  await run([
    "run",
    "-d",
    "--rm",
    "--name",
    fixture,
    "--network",
    network,
    "--read-only",
    "-v",
    `${path.join(root, "test/s3-fixture.ts")}:/tmp/s3-fixture.ts:ro`,
    "--entrypoint",
    "bun",
    "storm-forum:dev",
    "/tmp/s3-fixture.ts",
  ]);
  // Use the current workspace image while retaining the source's licensed
  // application and data. A long-lived preview can have older dependencies.
  const snapshotOutput = await run([
    "run",
    "--rm",
    "--network",
    network,
    "--volumes-from",
    source,
    "--read-only",
    "--tmpfs",
    "/tmp:uid=1000,gid=1000",
    ...bootstrap,
    "--entrypoint",
    "bun",
    "storm-forum:dev",
    "/opt/storm-forum/test/backup-roundtrip.ts",
  ]);
  const manifestKey = snapshotOutput.trim();
  if (!/^snapshots\/beta\/[a-f0-9-]+\/manifest\.json$/.test(manifestKey)) {
    throw new Error("Snapshot did not return a committed manifest");
  }
  await run(
    [
      "run",
      "-d",
      "--rm",
      "--name",
      database,
      "--network",
      network,
      "--user",
      "999:999",
      "--read-only",
      "--tmpfs",
      "/run/mysqld:uid=999,gid=999",
      "--tmpfs",
      "/tmp:uid=999,gid=999",
      "-e",
      "MARIADB_DATABASE",
      "-e",
      "MARIADB_USER",
      "-e",
      "MARIADB_PASSWORD",
      "-e",
      "MARIADB_ROOT_PASSWORD",
      "mariadb:11.8@sha256:79d59758afc91b89b120b0a8904d637f5a3b3e1c4900f29b740d6d46c72fef68",
    ],
    {
      MARIADB_DATABASE: sourceEnv["DB_NAME"] ?? "",
      MARIADB_USER: sourceEnv["DB_USER"] ?? "",
      MARIADB_PASSWORD: sourceEnv["DB_PASSWORD"] ?? "",
    },
  );
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const probe = Bun.spawn(
      [
        "docker",
        "exec",
        database,
        "healthcheck.sh",
        "--connect",
        "--innodb_initialized",
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    if ((await probe.exited) === 0) {
      ready = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!ready) {
    throw new Error("Isolated restore database did not become ready");
  }
  await run(
    [
      "run",
      "-d",
      "--rm",
      "--name",
      target,
      "--network",
      network,
      ...bootstrap,
      "-e",
      "RESTORE_MANIFEST_KEY",
      "-v",
      "/app/forum",
      "-v",
      "/var/lib/storm-forum",
      "--tmpfs",
      "/tmp:uid=1000,gid=1000",
      "--read-only",
      ...["src", "config", "test", "runtime", "package.json"].flatMap(
        (name) => [
          "-v",
          `${path.join(root, name)}:/opt/storm-forum/${name}:ro`,
        ],
      ),
      "--entrypoint",
      "sh",
      "storm-forum:dev",
      "-c",
      "mkdir -p /var/lib/storm-forum/data /var/lib/storm-forum/internal_data /tmp/storm-forum && sleep infinity",
    ],
    {
      DB_HOST: database,
      RESTORE_MANIFEST_KEY: manifestKey,
      BUNDLE_SHA256: "b".repeat(64),
    },
  );
  // Reuse the licensed application only inside the disposable container filesystem.
  const archive = Bun.spawn(
    ["docker", "exec", source, "tar", "-cf", "-", "-C", "/app/forum", "."],
    { stdout: "pipe", stderr: "ignore" },
  );
  const extract = Bun.spawn(
    ["docker", "exec", "-i", target, "tar", "-xf", "-", "-C", "/app/forum"],
    { stdin: archive.stdout, stdout: "ignore", stderr: "ignore" },
  );
  const copyCodes = await Promise.all([archive.exited, extract.exited]);
  if (copyCodes.some((code) => code !== 0)) {
    throw new Error("Private application fixture copy failed");
  }
  await run(["exec", target, "bun", "/opt/storm-forum/src/cli.ts", "restore"]);
  process.stdout.write(
    await run([
      "exec",
      "-w",
      "/app/forum",
      target,
      "php",
      "/opt/storm-forum/test/restored.php",
    ]),
  );
} finally {
  for (const name of [target, database, fixture]) {
    const cleanup = Bun.spawn(["docker", "rm", "-f", name], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await cleanup.exited;
  }
}
