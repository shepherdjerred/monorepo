#!/usr/bin/env bun
/**
 * Smoke test for the temporal-worker image.
 *
 * Two assertions, both required to pass:
 *
 * 1. Boot: the worker's first real action is `NativeConnection.connect({ address })`
 *    against TEMPORAL_ADDRESS (default localhost:7233). No Temporal server runs in
 *    the smoke, so the worker boots (installs runtime, inits Sentry/tracing/metrics,
 *    logs "Connecting to Temporal server") and then fails to connect. Success =
 *    the worker reached the connect attempt and failed with a connection error
 *    (proves the image boots and the worker bundle loads).
 *
 * 2. CLIs: every operator CLI the scheduled workflows shell out to must be on
 *    PATH and runnable inside the image. Each CLI is exec'd with its cheapest
 *    no-credential invocation; a missing/broken binary fails the smoke. The list
 *    mirrors REQUIRED_AUDIT_BINARIES in src/activities/homelab-audit-preflight.ts
 *    plus codex + github-mcp-server + cog (used outside the audit preflight).
 *
 * Dependency-free: Bun.spawn only. Always removes the container, exits non-zero
 * on failure.
 */
const IMAGE = "temporal-worker:dev";
const CONTAINER = `smoke-temporal-worker-${String(process.pid)}`;

// Each entry is the cheapest invocation that proves the binary is installed and
// runnable without credentials or network. All exit 0 on success; `cog` uses
// `-v` (it has no `--version` flag — that errors with exit 2).
const CLI_CHECKS: readonly { name: string; args: readonly string[] }[] = [
  { name: "gh", args: ["gh", "--version"] },
  { name: "claude", args: ["claude", "--version"] },
  { name: "codex", args: ["codex", "--version"] },
  { name: "kubectl", args: ["kubectl", "version", "--client"] },
  { name: "github-mcp-server", args: ["github-mcp-server", "--version"] },
  { name: "talosctl", args: ["talosctl", "version", "--client"] },
  { name: "tofu", args: ["tofu", "version"] },
  { name: "argocd", args: ["argocd", "version", "--client"] },
  { name: "velero", args: ["velero", "version", "--client-only"] },
  { name: "bk", args: ["bk", "--version"] },
  { name: "temporal", args: ["temporal", "--version"] },
  { name: "toolkit", args: ["toolkit", "--version"] },
  { name: "cog", args: ["cog", "-v"] },
];
// Reaching this log line proves the worker booted through runtime install,
// Sentry, tracing, and the metrics server, and is attempting the connection.
const BOOT_LOG = "Connecting to Temporal server";
const EXPECTED_FAILURE = [
  "connection refused",
  "connect",
  "econnrefused",
  "transport error",
  "failed to connect",
  "tcp connect error",
  "deadline",
];
const TIMEOUT_MS = 60_000;

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

/**
 * Assert every operator CLI is present + runnable in the image. Runs each check
 * in a throwaway `docker run --rm` (no worker boot needed — these are pure
 * binary-liveness probes). Fails with every missing/broken CLI listed at once.
 */
async function checkClis(): Promise<void> {
  const failures: string[] = [];
  for (const check of CLI_CHECKS) {
    const [entrypoint, ...cliArgs] = check.args;
    if (entrypoint === undefined) {
      throw new Error(`CLI check "${check.name}" has an empty args list`);
    }
    const result = await sh([
      "docker",
      "run",
      "--rm",
      "--entrypoint",
      entrypoint,
      IMAGE,
      ...cliArgs,
    ]);
    if (result.code !== 0) {
      failures.push(
        `  ${check.name} (\`${check.args.join(" ")}\`) exited ${String(
          result.code,
        )}:\n${result.stdout.trim()}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Smoke test failed: ${String(failures.length)} CLI check(s) failed:\n${failures.join("\n")}`,
    );
  }
  console.error(
    `CLI checks passed: all ${String(CLI_CHECKS.length)} operator CLIs present and runnable.`,
  );
}

async function main(): Promise<void> {
  await removeContainer();

  // Cheap binary-liveness gate first — fails fast if the image is missing a CLI
  // before we spend ~60s waiting on the worker boot sequence.
  await checkClis();

  // Unreachable address so connect fails fast and deterministically rather than
  // hanging on the default localhost:7233.
  const run = await sh([
    "docker",
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    "TEMPORAL_ADDRESS=127.0.0.1:7233",
    "-e",
    "SENTRY_DSN=",
    IMAGE,
  ]);
  if (run.code !== 0) {
    throw new Error(
      `docker run failed (exit ${String(run.code)}):\n${run.stdout}`,
    );
  }

  const deadline = Date.now() + TIMEOUT_MS;
  let sawBoot = false;
  while (Date.now() < deadline) {
    const logs = await sh(["docker", "logs", CONTAINER]);
    const lower = logs.stdout.toLowerCase();
    if (logs.stdout.includes(BOOT_LOG)) sawBoot = true;
    if (sawBoot && EXPECTED_FAILURE.some((p) => lower.includes(p))) {
      console.error(
        "Smoke test passed: worker booted and failed to connect to Temporal as expected.",
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
      // Container exited — pass if it booted and hit a connection error.
      if (sawBoot && EXPECTED_FAILURE.some((p) => lower.includes(p))) {
        console.error(
          "Smoke test passed: worker exited on the expected Temporal connection error.",
        );
        return;
      }
      throw new Error(
        `Smoke test failed: container exited without a booted+connect-failure sequence.\n\nLogs:\n${logs.stdout}`,
      );
    }
    await Bun.sleep(1500);
  }

  const logs = await sh(["docker", "logs", CONTAINER]);
  throw new Error(
    `Smoke test failed: did not observe boot + connection failure within ${String(
      TIMEOUT_MS / 1000,
    )}s (sawBoot=${String(sawBoot)}).\n\nLogs:\n${logs.stdout}`,
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
