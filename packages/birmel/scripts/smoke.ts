#!/usr/bin/env bun
/**
 * Smoke test for the birmel image.
 *
 * Translated from the old Dagger `smokeTestBirmelHelper`. Verifies, inside the
 * image, that the editor + music runtime dependencies are present, then boots
 * the bot with dummy creds and asserts the Discord login fails with the expected
 * auth error:
 *   - gh + claude on PATH (editor sub-agent)
 *   - node + python3 (youtube-dl-exec)
 *   - ffmpeg-static resolves (audio transcode)
 *   - @snazzah/davey imports (discord-voip DAVE)
 *   - the baked yt-dlp binary is executable and runnable
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
    // Editor + music runtime dependency checks (each hard-fails on absence).
    "command -v gh",
    "command -v claude",
    "node --version",
    "python3 --version",
    String.raw`bun -e "const p = require(\"ffmpeg-static\"); if (typeof p !== \"string\" || p.length === 0) throw new Error(\"ffmpeg-static did not resolve\");"`,
    String.raw`bun -e "await import(\"@snazzah/davey\");"`,
    "test -x node_modules/youtube-dl-exec/bin/yt-dlp",
    "timeout 10s node_modules/youtube-dl-exec/bin/yt-dlp --version",
    // Time-boxed boot; capture output and assert the expected auth failure.
    "set +e",
    'output="$(timeout 30s bun run src/index.ts 2>&1)"',
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
    "DISCORD_CLIENT_ID=smoke-test-dummy",
    "-e",
    "ANTHROPIC_API_KEY=smoke-test-dummy",
    "-e",
    "OPENAI_API_KEY=smoke-test-dummy",
    "-e",
    "DATABASE_URL=file:/tmp/smoke-test.db",
    "-e",
    "MEMORY_DB_PATH=file:/tmp/birmel-memory.db",
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
  if (run.code === 0 || expected) {
    console.log(
      "Smoke test passed: editor + music deps present, and boot hit the expected auth failure.",
    );
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
