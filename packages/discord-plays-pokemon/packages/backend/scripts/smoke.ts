#!/usr/bin/env bun
/**
 * Smoke test for the discord-plays-pokemon image.
 *
 * Translated from the old Dagger `smokeTestDiscordPlaysPokemonHelper`: the app
 * boots from the inner-monorepo root, loads a minimal `config.toml` that passes
 * Zod validation with dummy tokens, and attempts a Discord login that fails with
 * the expected token error. A clean exit or timeout-kill also counts (startup
 * ran without an unexpected crash).
 *
 * The config is written to a host temp file and bind-mounted into the container
 * at the path getConfig() reads (CWD/config.toml). Dependency-free: Bun.spawn +
 * Bun APIs + node:os only. Always removes the container; exits non-zero on failure.
 */
import { tmpdir } from "node:os";

const IMAGE = "discord-plays-pokemon:dev";
const CONTAINER = `smoke-dpp-${String(process.pid)}`;
const TIMEOUT_MS = 60_000;

const EXPECTED_FAILURE_PATTERNS = [
  "tokeninvalid",
  "401",
  "unauthorized",
  "invalid token",
  "used disallowed intents",
];

// Minimal config.toml that passes Zod validation but uses dummy tokens. The bot
// is enabled so the Discord login runs and rejects with TokenInvalid; game/
// stream/web are disabled so no ROM, voice, or port binding is needed.
const CONFIG_TOML = `
server_id = "000000000000000000"

[bot]
enabled = true
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
enabled = false
channel_id = "000000000000000000"
dynamic_streaming = false
minimum_in_channel = 0
require_watching = false

[stream.userbot]
id = "000000000000000000"
token = "smoke-test-dummy-selfbot-token"

[stream.video]
scale = 3
frame_rate = 30
bitrate_kbps = 1500
bitrate_max_kbps = 4000

[game]
enabled = false
wasm_path = "packages/backend/assets/pokeemerald.wasm"

[game.commands]
enabled = false
channel_id = "000000000000000000"
max_actions_per_command = 1
max_quantity_per_action = 1
key_press_duration_in_milliseconds = 100
delay_between_actions_in_milliseconds = 100

[game.commands.burst]
duration_in_milliseconds = 100
delay_in_milliseconds = 100
quantity = 1

[game.commands.chord]
duration_in_milliseconds = 100
max_commands = 1
max_total = 1
delay = 100

[game.commands.hold]
duration_in_milliseconds = 100

[web]
enabled = false
cors = false
port = 3000
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
      // Bind the config into the inner-monorepo root, where getConfig() reads it.
      "-v",
      `${configPath}:/app/packages/discord-plays-pokemon/config.toml:ro`,
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

const dir = `${tmpdir()}/dpp-smoke-${String(process.pid)}`;
const configPath = `${dir}/config.toml`;
await Bun.write(configPath, CONFIG_TOML);

try {
  await main(configPath);
} finally {
  await removeContainer();
  Bun.spawnSync(["rm", "-rf", dir]);
}
