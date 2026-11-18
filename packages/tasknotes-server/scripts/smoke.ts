#!/usr/bin/env bun
/**
 * Smoke test for the tasknotes-server image.
 *
 * The server starts in-memory when DATABASE_URL is unset, so success is a clean
 * boot — the server reaching its "listening" log line. We run the container
 * detached and poll its logs for that line, then tear the container down.
 *
 * Dependency-free: Bun.spawn only. Exits non-zero on failure and always removes
 * the container (even on failure).
 */
const IMAGE = "tasknotes-server:dev";
const CONTAINER = `smoke-tasknotes-server-${String(process.pid)}`;
const READY_LOG = "TaskNotes server listening on 127.0.0.1:3000";
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
    "AUTH_TOKEN=smoke-test-token",
    "-e",
    "PORT=3000",
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
      console.log("Smoke test passed: server reached its listening log line.");
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

void (async () => {
  try {
    await main();
  } finally {
    await removeContainer();
  }
})();
