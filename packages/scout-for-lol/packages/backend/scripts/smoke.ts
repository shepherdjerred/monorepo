#!/usr/bin/env bun
/**
 * Smoke test for the scout-for-lol backend image.
 *
 * Translated from the old Dagger `smokeTestScoutForLolHelper`: boot the image
 * with dummy credentials and assert the app gets far enough to attempt Discord
 * auth and fail with the expected token error (config loaded, HTTP server
 * started, Discord login rejected). A clean exit or a timeout-kill also counts
 * as a pass — the point is that startup ran without an unexpected crash.
 *
 * Dependency-free: Bun.spawn only. Always removes the container (even on
 * failure) and exits non-zero when the boot fails for an unexpected reason.
 */
const IMAGE = "scout-for-lol:dev";
const CONTAINER = `smoke-scout-for-lol-${String(process.pid)}`;
const TIMEOUT_MS = 45_000;

// Substrings that prove the app booted and reached the Discord auth path.
// Matched case-insensitively against combined container stdout+stderr.
const EXPECTED_FAILURE_PATTERNS = [
  "tokeninvalid",
  "401",
  "unauthorized",
  "invalid token",
  "used disallowed intents",
];

async function sh(cmd: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

async function removeContainer(): Promise<void> {
  await sh(["docker", "rm", "-f", CONTAINER]);
}

async function main(): Promise<void> {
  await removeContainer();

  // Run in the foreground so we capture the full boot log and let the process
  // exit on its own; `--stop-timeout` bounds the run if it stays up (a booted
  // service that never fails auth is still a pass — we kill it and inspect).
  const proc = Bun.spawn(
    [
      "docker",
      "run",
      "--name",
      CONTAINER,
      "-e",
      "DISCORD_TOKEN=smoke-test-dummy",
      "-e",
      "APPLICATION_ID=000000000000000000",
      "-e",
      "RIOT_API_KEY=smoke-test-dummy",
      "-e",
      "DATABASE_URL=file:/tmp/smoke-test.db",
      "-e",
      "PORT=3000",
      IMAGE,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const timer = setTimeout(() => {
    // Booted-and-stable is a valid outcome; stop the container so the run ends.
    void sh(["docker", "stop", "-t", "2", CONTAINER]);
  }, TIMEOUT_MS);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  clearTimeout(timer);

  const combined = `${stdout}\n${stderr}`.toLowerCase();
  const matched = EXPECTED_FAILURE_PATTERNS.find((p) => combined.includes(p));

  if (matched !== undefined) {
    console.log(
      `Smoke test passed: reached Discord auth and failed as expected (matched "${matched}").`,
    );
    return;
  }

  // A clean exit (0) or a stop-kill (137/143 after the timeout fired) means the
  // service booted without an unexpected crash — also a pass.
  if (code === 0 || code === 137 || code === 143) {
    console.log(
      `Smoke test passed: image booted cleanly (exit ${String(code)}).`,
    );
    return;
  }

  throw new Error(
    `Smoke test failed: unexpected exit ${String(code)} with no expected auth error.\n\n` +
      `stdout:\n${stdout}\n\nstderr:\n${stderr}`,
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
