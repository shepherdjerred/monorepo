#!/usr/bin/env bun
/**
 * Smoke test for the tasknotes-server image.
 *
 * Translated from the old Dagger `smokeTestTasknotesServerHelper`: the server
 * starts fully with defaults (no external auth), so success is a clean boot —
 * the server reaching its "listening" log line. We run the container detached
 * and poll its logs for that line, then tear the container down.
 *
 * Dependency-free: Bun.spawn only. Exits non-zero on failure and always removes
 * the container (even on failure).
 */
const IMAGE = "tasknotes-server:dev";
const CONTAINER = `smoke-tasknotes-server-${String(process.pid)}`;
const READY_LOG = "TaskNotes server listening on port";
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

  // The old Dagger smoke `mkdir -p /tmp/smoke-vault` before boot; the server
  // scans VAULT_PATH on startup and crashes if it's missing. Override the
  // command to create it first, then exec the real entrypoint.
  const run = await sh([
    "docker",
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    "VAULT_PATH=/tmp/smoke-vault",
    "-e",
    "AUTH_TOKEN=smoke-test-token",
    "-e",
    "PORT=3000",
    "--entrypoint",
    "sh",
    IMAGE,
    "-c",
    "mkdir -p /tmp/smoke-vault && exec bun packages/tasknotes-server/src/index.ts",
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
      console.log("Smoke test passed: server reached its listening log line.");
      return;
    }
    // If the container died before becoming ready, fail fast with its logs.
    const state = await sh([
      "docker",
      "inspect",
      "-f",
      "{{.State.Running}}",
      CONTAINER,
    ]);
    if (state.stdout.trim() === "false") {
      throw new Error(
        `Smoke test failed: container exited before becoming ready.\n\nLogs:\n${logs.stdout}`,
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

// Async IIFE instead of top-level await: these package tsconfigs
// (CommonJS/Node16 module) reject TLA (same pattern as ensure-ha-schema.ts).
void (async () => {
  try {
    await main();
  } finally {
    await removeContainer();
  }
})();
