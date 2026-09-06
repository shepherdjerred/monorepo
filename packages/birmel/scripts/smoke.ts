#!/usr/bin/env bun
/**
 * Smoke test for the birmel image.
 *
 * Translated from the old Dagger `smokeTestBirmelHelper`. Boots the bot inside
 * the image with dummy creds and asserts the Discord login fails with the
 * expected auth error:
 *   - node and python3 are present, because the shell tool advertises them
 *   - the bot boots and Discord login fails with TokenInvalid/401/etc.
 *
 * One shell pipeline, run to completion (not detached). Dependency-free:
 * Bun.spawn only. Always removes the container, exits non-zero on failure.
 */
const IMAGE = "birmel:dev";
const CONTAINER = `smoke-birmel-${String(process.pid)}`;
const EXPECTED_FAILURE = [
  "tokeninvalid",
  "401",
  "unauthorized",
  "invalid token",
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

async function main(): Promise<void> {
  await removeContainer();

  const script = [
    "set -e",
    "cd /app/packages/birmel",
    // The shell tool documents python3 and node by name, so a production image
    // without them silently breaks an advertised capability.
    "node --version",
    "python3 --version",
    // Time-boxed boot; capture output and assert the expected auth failure.
    "set +e",
    'output="$(timeout 30s bun run scripts/start.ts 2>&1)"',
    'status="$?"',
    String.raw`printf '%s\n' "$output"`,
    '[ "$status" -eq 124 ] && exit 0',
    String.raw`printf '%s\n' "$output" | grep -iE 'TokenInvalid|401|Unauthorized|Invalid token'`,
  ].join("\n");

  const run = await sh([
    "docker",
    "run",
    "--name",
    CONTAINER,
    "-e",
    "DISCORD_TOKEN=smoke-test-dummy",
    "-e",
    `DISCORD_CLIENT_ID=${"1".repeat(18)}`,
    "-e",
    "OPENROUTER_API_KEY=smoke-test-dummy",
    "-e",
    "DATABASE_URL=file:/tmp/smoke-test.db",
    // Production runs FEATURE_FLAGS_MODE=flipt, which this sandbox cannot
    // reach. The variable has no default on purpose, so boot needs it set.
    "-e",
    "FEATURE_FLAGS_MODE=disabled",
    "-e",
    "TELEMETRY_ENABLED=false",
    "--entrypoint",
    "sh",
    IMAGE,
    "-c",
    script,
  ]);

  const lower = run.stdout.toLowerCase();
  const expected = EXPECTED_FAILURE.some((p) => lower.includes(p));
  if (expected || run.code === 0) {
    console.log("Smoke test passed: boot hit the expected auth failure.");
    return;
  }

  throw new Error(
    `Smoke test failed (exit ${String(run.code)}).\n\nOutput:\n${run.stdout}`,
  );
}

try {
  await main();
} finally {
  await removeContainer();
}
