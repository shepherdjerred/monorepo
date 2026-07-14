#!/usr/bin/env bun
/**
 * Smoke test for the discord-plays-mario-kart image.
 *
 * Translated from the old Dagger `smokeTestDiscordPlaysMarioKartHelper`: run the
 * REAL container entrypoint (including the `prisma db push` prelude) so a broken
 * migration command can't sail through. The emulator is disabled (no ROM in CI);
 * the stream is enabled so the selfbot login runs and rejects with the expected
 * token error. A clean exit or timeout-kill also counts.
 *
 * The config is written to a host temp file and bind-mounted at the path
 * getConfig() reads (inner-root/config.toml). Dependency-free: Bun.spawn +
 * Bun APIs + node:os only. Always removes the container; exits non-zero on failure.
 */
import { tmpdir } from "node:os";

const IMAGE = "discord-plays-mario-kart:dev";
const CONTAINER = `smoke-dpmk-${String(process.pid)}`;
const TIMEOUT_MS = 60_000;

const EXPECTED_FAILURE_PATTERNS = [
  "tokeninvalid",
  "401",
  "unauthorized",
  "invalid token",
  "used disallowed intents",
];

// Minimal config.toml that passes Zod validation but uses dummy tokens.
// emulator disabled (no ROM available in CI); stream enabled so the selfbot
// login runs and rejects with TokenInvalid.
const CONFIG_TOML = `
server_id = "000000000000000000"

[bot]
enabled = false
discord_token = "smoke-test-dummy-token"
application_id = "000000000000000000"

[bot.commands]
enabled = false
update = false

[bot.commands.screenshot]
enabled = false

[bot.notifications]
channel_id = "000000000000000000"
enabled = false

[stream]
enabled = true
channel_id = "000000000000000000"
dynamic_streaming = false
minimum_in_channel = 0
require_watching = false

[stream.userbot]
id = "000000000000000000"
token = "smoke-test-dummy-selfbot-token"

[stream.video]
scale = 2
frame_rate = 30
bitrate_kbps = 1500
bitrate_max_kbps = 4000

[emulator]
enabled = false
wasm_dir = "packages/backend/assets/n64wasm"
rom_path = "roms/mariokart64.z64"
fps = 30
software_render = true
seats = 4

[web]
enabled = false
cors = false
port = 8081
assets = "/tmp"

[web.api]
enabled = false
`;

async function sh(cmd: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

async function removeContainer(): Promise<void> {
  await sh(["docker", "rm", "-f", CONTAINER]);
}

async function main(configPath: string): Promise<void> {
  await removeContainer();

  const proc = Bun.spawn(
    [
      "docker",
      "run",
      "--name",
      CONTAINER,
      // Writable SQLite target for the `prisma db push` prelude (prod uses a PVC;
      // here any writable path works).
      "-e",
      "DATABASE_PATH=/tmp/smoke-leaderboard.db",
      // Bind the config into the inner-monorepo root, where getConfig() reads it.
      "-v",
      `${configPath}:/app/packages/discord-plays-mario-kart/config.toml:ro`,
      IMAGE,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const timer = setTimeout(() => {
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
    console.error(
      `Smoke test passed: reached Discord auth and failed as expected (matched "${matched}").`,
    );
    return;
  }

  if (code === 0 || code === 137 || code === 143) {
    console.error(
      `Smoke test passed: image booted cleanly (exit ${String(code)}).`,
    );
    return;
  }

  throw new Error(
    `Smoke test failed: unexpected exit ${String(code)} with no expected auth error.\n\n` +
      `stdout:\n${stdout}\n\nstderr:\n${stderr}`,
  );
}

const dir = `${tmpdir()}/dpmk-smoke-${String(process.pid)}`;
const configPath = `${dir}/config.toml`;
await Bun.write(configPath, CONFIG_TOML);

try {
  await main(configPath);
} finally {
  await removeContainer();
  Bun.spawnSync(["rm", "-rf", dir]);
}
