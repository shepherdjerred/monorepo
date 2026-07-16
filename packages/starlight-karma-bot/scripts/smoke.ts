#!/usr/bin/env bun
/**
 * Smoke test for the starlight-karma-bot image.
 *
 * Translated from the old Dagger `smokeTestStarlightKarmaBotHelper`: boot with
 * dummy Discord creds and a writable DATA_DIR; the bot loads config, starts, and
 * attempts a Discord login that must fail with the expected auth error. Success
 * = the container's logs contain one of the expected auth-failure patterns (the
 * app got far enough to attempt login with the invalid token).
 *
 * Dependency-free: Bun.spawn only. Always removes the container, exits non-zero
 * on failure.
 */
const IMAGE = "starlight-karma-bot:dev";
const CONTAINER = `smoke-starlight-karma-bot-${String(process.pid)}`;
const TIMEOUT_MS = 30_000;
const EXPECTED_FAILURE = [
  "TokenInvalid",
  "401",
  "Unauthorized",
  "Invalid token",
  "An invalid token was provided",
];

async function sh(cmd: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stdout: `${stdout}${stderr}` };
}

async function removeContainer(): Promise<void> {
  await sh(["docker", "rm", "-f", CONTAINER]);
}

function matchesExpected(logs: string): boolean {
  const lower = logs.toLowerCase();
  return EXPECTED_FAILURE.some((p) => lower.includes(p.toLowerCase()));
}

async function main(): Promise<void> {
  await removeContainer();

  const run = await sh([
    "docker",
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    "DISCORD_TOKEN=smoke-test-dummy",
    "-e",
    "APPLICATION_ID=000000000000000000",
    "-e",
    "DATA_DIR=/tmp/smoke-data",
    "--entrypoint",
    "sh",
    IMAGE,
    "-c",
    // Run from the package dir (the image's WORKDIR) so Bun uses this package's
    // tsconfig — TypeORM entities need emitDecoratorMetadata.
    "mkdir -p /tmp/smoke-data && cd /app/packages/starlight-karma-bot && exec bun src/index.ts",
  ]);
  if (run.code !== 0) {
    throw new Error(
      `docker run failed (exit ${String(run.code)}):\n${run.stdout}`,
    );
  }

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const logs = await sh(["docker", "logs", CONTAINER]);
    if (matchesExpected(logs.stdout)) {
      console.error(
        "Smoke test passed: bot booted and Discord login failed with the expected auth error.",
      );
      return;
    }
    const state = await sh([
      "docker",
      "inspect",
      "-f",
      "{{.State.Running}}",
      CONTAINER,
    ]);
    if (state.stdout.trim() === "false") {
      // Container exited — check its final logs for the expected auth error.
      if (matchesExpected(logs.stdout)) {
        console.error(
          "Smoke test passed: bot exited on the expected Discord auth error.",
        );
        return;
      }
      throw new Error(
        `Smoke test failed: container exited without an expected auth error.\n\nLogs:\n${logs.stdout}`,
      );
    }
    await Bun.sleep(1000);
  }

  const logs = await sh(["docker", "logs", CONTAINER]);
  throw new Error(
    `Smoke test failed: no expected auth error within ${String(
      TIMEOUT_MS / 1000,
    )}s.\n\nLogs:\n${logs.stdout}`,
  );
}

try {
  await main();
} finally {
  await removeContainer();
}
