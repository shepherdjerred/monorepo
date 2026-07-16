#!/usr/bin/env bun
/**
 * Smoke test for the trmnl-dashboard image.
 *
 * Translated from the old Dagger `smokeTestTrmnlDashboardHelper`: Zod config
 * parses with the required env vars present and Bun.serve binds to port 3000.
 * Success = the "listening on :3000" boot log line (the old test's expected
 * pattern). No external auth is attempted at boot.
 *
 * Dependency-free: Bun.spawn only. Always removes the container, exits non-zero
 * on failure.
 */
const IMAGE = "trmnl-dashboard:dev";
const CONTAINER = `smoke-trmnl-dashboard-${String(process.pid)}`;
const READY_LOG = "listening on :3000";
const TIMEOUT_MS = 30_000;

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

async function main(): Promise<void> {
  await removeContainer();

  const run = await sh([
    "docker",
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    "TRMNL_API_KEY=smoke-test-dummy",
    "-e",
    "HA_TOKEN=smoke-test-dummy",
    "-e",
    "HA_URL=http://127.0.0.1:9999",
    IMAGE,
  ]);
  if (run.code !== 0) {
    throw new Error(
      `docker run failed (exit ${String(run.code)}):\n${run.stdout}`,
    );
  }

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const logs = await sh(["docker", "logs", CONTAINER]);
    if (logs.stdout.includes(READY_LOG)) {
      console.log(
        "Smoke test passed: Bun.serve bound and logged its listening line.",
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
      throw new Error(
        `Smoke test failed: container exited before binding.\n\nLogs:\n${logs.stdout}`,
      );
    }
    await Bun.sleep(1000);
  }

  const logs = await sh(["docker", "logs", CONTAINER]);
  throw new Error(
    `Smoke test failed: "${READY_LOG}" not seen within ${String(
      TIMEOUT_MS / 1000,
    )}s.\n\nLogs:\n${logs.stdout}`,
  );
}

try {
  await main();
} finally {
  await removeContainer();
}
