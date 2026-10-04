import path from "node:path";
import { randomBytes } from "node:crypto";

// Vendor source is an explicit local input, outside the public Docker build context.
const upload = Bun.argv[2];
if (
  upload === undefined ||
  !(await Bun.file(path.resolve(upload, "src/XF.php")).exists())
) {
  throw new Error(
    "Usage: local-integration.ts <licensed XenForo upload directory>",
  );
}
const suffix = randomBytes(4).toString("hex");
const network = `storm-forum-test-${suffix}`;
const db = `${network}-db`;
const app = `${network}-app`;
const web = `${network}-web`;
const env = {
  ...Bun.env,
  DB_HOST: db,
  DB_USER: "storm",
  DB_NAME: "storm",
  DB_PASSWORD: randomBytes(32).toString("hex"),
  MARIADB_ROOT_PASSWORD: randomBytes(32).toString("hex"),
  ADMIN_USERNAME: "StormLocalAdmin",
  ADMIN_EMAIL: "local@example.test",
  ADMIN_PASSWORD: randomBytes(32).toString("hex"),
  FORUM_URL: "http://127.0.0.1:18796",
  POSTAL_SMTP_USERNAME: "local-test",
  POSTAL_SMTP_PASSWORD: randomBytes(32).toString("hex"),
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
};
const run = async (args: string[]) => {
  const child = Bun.spawn(["docker", ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (
    code !== 0 ||
    /An exception occurred:|Fatal error:|An unexpected error occurred/.test(
      out + err,
    )
  ) {
    let diagnostics = out + err;
    for (const value of [
      env.DB_PASSWORD,
      env.MARIADB_ROOT_PASSWORD,
      env.ADMIN_PASSWORD,
      env.POSTAL_SMTP_PASSWORD,
      env.TURNSTILE_SECRET_KEY,
    ]) {
      diagnostics = diagnostics.replaceAll(value, "<redacted>");
    }
    throw new Error(
      `Docker operation failed (${String(code)}): ${diagnostics}`,
    );
  }
  return out;
};
await run(["network", "create", network]);
try {
  // Pass environment names only, never credential values in process argv.
  const dbEnv = {
    ...env,
    MARIADB_USER: env.DB_USER,
    MARIADB_PASSWORD: env.DB_PASSWORD,
    MARIADB_DATABASE: env.DB_NAME,
  };
  const database = Bun.spawn(
    [
      "docker",
      "run",
      "-d",
      "--rm",
      "--name",
      db,
      "--network",
      network,
      "-e",
      "MARIADB_USER",
      "-e",
      "MARIADB_PASSWORD",
      "-e",
      "MARIADB_DATABASE",
      "-e",
      "MARIADB_ROOT_PASSWORD",
      "mariadb:11.8@sha256:79d59758afc91b89b120b0a8904d637f5a3b3e1c4900f29b740d6d46c72fef68",
    ],
    { env: dbEnv, stdout: "ignore", stderr: "ignore" },
  );
  if ((await database.exited) !== 0) {
    throw new Error("Disposable database startup failed");
  }
  const credentials = Object.keys(env).flatMap((key) =>
    /^(?:DB_|ADMIN_|FORUM_URL|POSTAL_|TURNSTILE_)/.test(key) ? ["-e", key] : [],
  );
  await run([
    "run",
    "-d",
    "--rm",
    "--name",
    app,
    "--network",
    network,
    ...credentials,
    "-p",
    "127.0.0.1:18796:8080",
    "-v",
    "/app/forum",
    "-v",
    "/var/lib/storm-forum",
    "-v",
    `${path.resolve(upload)}:/private/upload:ro`,
    ...[
      "src",
      "config",
      "addon",
      "runtime",
      "styles",
      "scripts",
      "test",
      "package.json",
    ].flatMap((name) => [
      "-v",
      `${path.resolve(import.meta.dirname, "..", name)}:/opt/storm-forum/${name}:ro`,
    ]),
    "--entrypoint",
    "sh",
    "storm-forum:dev",
    "-c",
    "cp -R /private/upload/. /app/forum/ && cp /opt/storm-forum/runtime/config.php /app/forum/src/config.php && cp -R /opt/storm-forum/addon/Storm /app/forum/src/addons/Storm && mkdir -p /var/lib/storm-forum/internal_data /tmp/storm-forum && sleep infinity",
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const probe = Bun.spawn(
      [
        "docker",
        "exec",
        db,
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
    throw new Error("Disposable database did not become ready");
  }
  process.stdout.write("Installing XenForo in disposable containers...\n");
  await run([
    "exec",
    "-w",
    "/app/forum",
    app,
    "php",
    "/opt/storm-forum/runtime/install.php",
  ]);
  await run([
    "exec",
    "-w",
    "/app/forum",
    app,
    "php",
    "cmd.php",
    "xf:addon-install",
    "Storm/Forum",
    "-n",
  ]);
  await run([
    "exec",
    "-w",
    "/app/forum",
    app,
    "php",
    "cmd.php",
    "storm:configure",
    "--stage",
    "beta",
  ]);
  await run([
    "exec",
    "-w",
    "/app/forum",
    app,
    "php",
    "cmd.php",
    "xf:run-jobs",
    "--max-execution-time",
    "50",
  ]);
  process.stdout.write(
    await run([
      "exec",
      "-w",
      "/app/forum",
      app,
      "php",
      "/opt/storm-forum/test/integration.php",
    ]),
  );
  await run([
    "exec",
    "-d",
    app,
    "bun",
    "/opt/storm-forum/test/smtp-fixture.ts",
  ]);
  process.stdout.write(
    await run([
      "exec",
      "-w",
      "/app/forum",
      app,
      "php",
      "/opt/storm-forum/test/mail.php",
    ]),
  );
  if (Bun.argv.includes("--preview")) {
    await run([
      "exec",
      "-w",
      "/app/forum",
      app,
      "php",
      "/opt/storm-forum/test/preview.php",
    ]);
    await run(["exec", app, "mkdir", "-p", "/app/forum/styles/storm"]);
    await run([
      "cp",
      path.resolve(import.meta.dirname, "../../ts-mc/public/logo.svg"),
      `${app}:/app/forum/styles/storm/logo.svg`,
    ]);
    await run([
      "cp",
      path.resolve(import.meta.dirname, "../assets/spawn.jpg"),
      `${app}:/app/forum/styles/storm/spawn.jpg`,
    ]);
    await run([
      "exec",
      "-d",
      app,
      "php-fpm",
      "--fpm-config",
      "/opt/storm-forum/runtime/fpm.conf",
    ]);
    await run([
      "run",
      "-d",
      "--rm",
      "--name",
      web,
      "--network",
      `container:${app}`,
      "--volumes-from",
      app,
      "-v",
      `${path.resolve(import.meta.dirname, "../runtime/nginx.conf")}:/etc/nginx/nginx.conf:ro`,
      "--user",
      "1000:1000",
      "--entrypoint",
      "nginx",
      "nginx:1.31.6-alpine@sha256:d10753d9289b8e3f884386351f73554ce72b631378949deddd75e83ee296c427",
      "-g",
      "daemon off;",
    ]);
    process.stdout.write(
      "Local core-style portal preview: http://127.0.0.1:18796 · Ctrl-C cleans up.\n",
    );
    await new Promise<void>((done) => {
      process.once("SIGINT", done);
    });
  }
} finally {
  for (const container of [web, app, db]) {
    const cleanup = Bun.spawn(["docker", "rm", "-f", container], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await cleanup.exited;
  }
  await run(["network", "rm", network]);
}
