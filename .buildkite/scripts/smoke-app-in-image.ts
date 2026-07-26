#!/usr/bin/env bun

/**
 * Runs production-image smoke assertions inside a BuildKit solve.
 *
 * This deliberately has no Docker client dependency: every command executes
 * in the image filesystem that will be pushed. Package-local Docker wrappers
 * continue to provide the same checks for developers, while CI invokes this
 * file from each Dockerfile's `smoke` target.
 */
const target = Bun.env.CI_IMAGE_SMOKE_TARGET;

if (target === undefined || target.length === 0) {
  throw new Error("CI_IMAGE_SMOKE_TARGET is required");
}

type SmokeResult = { readonly exitCode: number; readonly output: string };

async function runShell(
  command: string,
  env: Record<string, string>,
): Promise<SmokeResult> {
  const process = Bun.spawn(["sh", "-c", command], {
    cwd: "/app",
    env: { ...Bun.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, output: `${stdout}\n${stderr}` };
}

function assertPassed(result: SmokeResult, label: string): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `${label} failed with exit ${String(result.exitCode)}:\n${result.output}`,
    );
  }
}

const discordAuthPattern =
  "TokenInvalid|401|Unauthorized|Invalid token|An invalid token was provided";

const pokemonSmokeConfig = `
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

const marioSmokeConfig = `
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

const commands: Record<
  string,
  { readonly command: string; readonly env: Record<string, string> }
> = {
  birmel: {
    command: [
      "set -eu",
      "cd /app/packages/birmel",
      "command -v gh",
      "command -v claude",
      "node --version",
      "python3 --version",
      String.raw`bun -e 'const p = require("ffmpeg-static"); if (typeof p !== "string" || p.length === 0) throw new Error("ffmpeg-static did not resolve");'`,
      String.raw`bun -e 'await import("@snazzah/davey");'`,
      "test -x node_modules/youtube-dl-exec/bin/yt-dlp",
      "timeout 10s node_modules/youtube-dl-exec/bin/yt-dlp --version",
      "set +e",
      'output="$(timeout 30s bun run src/index.ts 2>&1)"',
      "status=$?",
      "printf '%s\\n' \"$output\"",
      '[ "$status" -eq 124 ] || printf "%s\\n" "$output" | grep -iE "' +
        discordAuthPattern +
        '"',
    ].join("\n"),
    env: {
      DISCORD_TOKEN: "smoke-test-dummy",
      DISCORD_CLIENT_ID: "smoke-test-dummy",
      ANTHROPIC_API_KEY: "smoke-test-dummy",
      OPENAI_API_KEY: "smoke-test-dummy",
      DATABASE_URL: "file:/tmp/smoke-test.db",
      MEMORY_DB_PATH: "file:/tmp/birmel-memory.db",
      TELEMETRY_ENABLED: "false",
    },
  },
  "starlight-karma-bot": {
    command: [
      "set -eu",
      "mkdir -p /tmp/smoke-data",
      "cd /app/packages/starlight-karma-bot",
      "set +e",
      'output="$(timeout 30s bun src/index.ts 2>&1)"',
      "status=$?",
      "printf '%s\\n' \"$output\"",
      '[ "$status" -eq 0 ] || printf "%s\\n" "$output" | grep -iE "' +
        discordAuthPattern +
        '"',
    ].join("\n"),
    env: {
      DISCORD_TOKEN: "smoke-test-dummy",
      APPLICATION_ID: "000000000000000000",
      DATA_DIR: "/tmp/smoke-data",
    },
  },
  streambot: {
    command: [
      "set -eu",
      "mkdir -p /tmp/videos",
      "cd /app/packages/streambot",
      "bun run test:integration",
      "ffmpeg -version >/dev/null",
      "/usr/local/bin/yt-dlp --version >/dev/null",
      "set +e",
      'output="$(timeout 30s bun run src/index.ts 2>&1)"',
      "status=$?",
      "printf '%s\\n' \"$output\"",
      '[ "$status" -eq 124 ] || printf "%s\\n" "$output" | grep -iE "' +
        discordAuthPattern +
        '"',
    ].join("\n"),
    env: {
      BOT_TOKEN: "smoke-test-dummy",
      USER_TOKENS: "smoke-test-dummy",
      ADMIN_IDS: "000000000000000000",
      VIDEOS_DIR: "/tmp/videos",
    },
  },
  "tasknotes-server": {
    command: [
      "set -eu",
      "mkdir -p /tmp/smoke-vault",
      "cd /app",
      "bun packages/tasknotes-server/src/index.ts >/tmp/tasknotes-smoke.log 2>&1 &",
      "pid=$!",
      "trap 'if kill -0 $pid; then kill $pid; if wait $pid; then :; else cleanup_status=$?; [ $cleanup_status -eq 143 ] || exit $cleanup_status; fi; fi' EXIT",
      "for _ in $(seq 1 30); do",
      "  if grep -Fq 'TaskNotes server listening on port' /tmp/tasknotes-smoke.log; then exit 0; fi",
      "  if ! kill -0 $pid; then cat /tmp/tasknotes-smoke.log; exit 1; fi",
      "  sleep 1",
      "done",
      "cat /tmp/tasknotes-smoke.log",
      "exit 1",
    ].join("\n"),
    env: {
      VAULT_PATH: "/tmp/smoke-vault",
      AUTH_TOKEN: "smoke-test-token",
      PORT: "3000",
    },
  },
  "temporal-worker": {
    command: [
      "set -eu",
      "cd /app/packages/temporal",
      "gh --version",
      "claude --version",
      "codex --version",
      "kubectl version --client",
      "github-mcp-server --version",
      "talosctl version --client",
      "tofu version",
      "argocd version --client",
      "velero version --client-only",
      "bk --version",
      "temporal --version",
      "toolkit --version",
      "cog -v",
      "set +e",
      'output="$(timeout 60s bun src/worker.ts 2>&1)"',
      "status=$?",
      "printf '%s\\n' \"$output\"",
      '[ "$status" -ne 124 ] && printf "%s\\n" "$output" | grep -F "Connecting to Temporal server" && printf "%s\\n" "$output" | grep -iE "connection refused|connect|econnrefused|transport error|failed to connect|tcp connect error|deadline"',
    ].join("\n"),
    env: { TEMPORAL_ADDRESS: "127.0.0.1:7233", SENTRY_DSN: "" },
  },
  "trmnl-dashboard": {
    command: [
      "set -eu",
      "cd /app/packages/trmnl-dashboard",
      "bun src/index.ts >/tmp/trmnl-smoke.log 2>&1 &",
      "pid=$!",
      "trap 'if kill -0 $pid; then kill $pid; if wait $pid; then :; else cleanup_status=$?; [ $cleanup_status -eq 143 ] || exit $cleanup_status; fi; fi' EXIT",
      "for _ in $(seq 1 30); do",
      "  if grep -Fq 'listening on :3000' /tmp/trmnl-smoke.log; then exit 0; fi",
      "  if ! kill -0 $pid; then cat /tmp/trmnl-smoke.log; exit 1; fi",
      "  sleep 1",
      "done",
      "cat /tmp/trmnl-smoke.log",
      "exit 1",
    ].join("\n"),
    env: {
      TRMNL_API_KEY: "smoke-test-dummy",
      HA_TOKEN: "smoke-test-dummy",
      HA_URL: "http://127.0.0.1:9999",
    },
  },
  "scout-for-lol": {
    command: [
      "set -eu",
      "cd /app/packages/scout-for-lol/packages/backend",
      "set +e",
      'output="$(timeout 45s sh -c \"bunx prisma migrate deploy && bun run src/index.ts\" 2>&1)"',
      "status=$?",
      "printf '%s\\n' \"$output\"",
      '[ "$status" -eq 0 ] || [ "$status" -eq 124 ] || printf "%s\\n" "$output" | grep -iE "' +
        discordAuthPattern +
        '"',
    ].join("\n"),
    env: {
      DISCORD_TOKEN: "smoke-test-dummy",
      APPLICATION_ID: "000000000000000000",
      RIOT_API_KEY: "smoke-test-dummy",
      DATABASE_URL: "file:/tmp/smoke-test.db",
      PORT: "3000",
    },
  },
  "discord-plays-pokemon": {
    command: [
      "set -eu",
      "cd /app/packages/discord-plays-pokemon",
      "set +e",
      'output="$(timeout 60s bun packages/backend/src/index.ts 2>&1)"',
      "status=$?",
      "printf '%s\\n' \"$output\"",
      '[ "$status" -eq 0 ] || [ "$status" -eq 124 ] || printf "%s\\n" "$output" | grep -iE "' +
        discordAuthPattern +
        '|used disallowed intents"',
    ].join("\n"),
    env: { SENTRY_DSN: "" },
  },
  "discord-plays-mario-kart": {
    command: [
      "set -eu",
      "cd /app/packages/discord-plays-mario-kart",
      "set +e",
      'output="$(timeout 60s sh -c \"cd packages/backend && bunx prisma db push && cd /app/packages/discord-plays-mario-kart && exec bun packages/backend/src/index.ts\" 2>&1)"',
      "status=$?",
      "printf '%s\\n' \"$output\"",
      '[ "$status" -eq 0 ] || [ "$status" -eq 124 ] || printf "%s\\n" "$output" | grep -iE "' +
        discordAuthPattern +
        '|used disallowed intents"',
    ].join("\n"),
    env: { SENTRY_DSN: "", DATABASE_PATH: "/tmp/smoke-leaderboard.db" },
  },
};

const command = commands[target];
if (command === undefined) {
  throw new Error(`no in-image smoke command exists for ${target}`);
}

if (target === "discord-plays-pokemon") {
  await Bun.write(
    "/app/packages/discord-plays-pokemon/config.toml",
    pokemonSmokeConfig,
  );
}
if (target === "discord-plays-mario-kart") {
  await Bun.write(
    "/app/packages/discord-plays-mario-kart/config.toml",
    marioSmokeConfig,
  );
}

assertPassed(
  await runShell(command.command, command.env),
  `${target} in-image smoke`,
);
console.log(`${target} in-image smoke passed`);
