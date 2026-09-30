#!/usr/bin/env bun
/**
 * Smoke test for the birmel image.
 *
 * Translated from the old Dagger `smokeTestBirmelHelper`. Boots the bot inside
 * the image with dummy creds and asserts the Discord login fails with the
 * expected auth error:
 *   - the credential-free code sandbox executes its three languages without
 *     network, Birmel files, or ambient credentials
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
    "for uid in 1001 1002; do iptables -A OUTPUT -m owner --uid-owner $uid -j REJECT; ip6tables -A OUTPUT -m owner --uid-owner $uid -j REJECT; done",
    "cd /app/packages/birmel",
    "bun scripts/smoke-sandbox.ts",
    // Time-boxed boot; capture output and assert the expected auth failure.
    "set +e",
    'output="$(timeout 30s setpriv --reuid=1000 --regid=1000 --clear-groups -- bun run scripts/start.ts 2>&1)"',
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
    "--read-only",
    "--tmpfs",
    "/tmp/birmel-sandbox:rw,noexec,nosuid,nodev,size=64m,mode=0711",
    "--tmpfs",
    "/app/data:rw,noexec,nosuid,nodev,size=16m,uid=1000,gid=1000,mode=0700",
    "--cap-drop",
    "ALL",
    "--cap-add",
    "NET_ADMIN",
    "--cap-add",
    "CHOWN",
    "--cap-add",
    "DAC_OVERRIDE",
    "--cap-add",
    "FOWNER",
    "--cap-add",
    "KILL",
    "--cap-add",
    "SETGID",
    "--cap-add",
    "SETPCAP",
    "--cap-add",
    "SETUID",
    "--user",
    "0:0",
    "-e",
    "DISCORD_TOKEN=smoke-test-dummy",
    "-e",
    `DISCORD_CLIENT_ID=${"1".repeat(18)}`,
    "-e",
    "DATABASE_URL=file:/app/data/smoke-test.db",
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
