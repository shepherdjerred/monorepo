/**
 * Miscellaneous helper functions (caddyfile, smokeTest).
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory, File, Secret } from "@dagger.io/dagger";

import {
  BUN_IMAGE,
  CADDY_BUILDER_IMAGE,
  CADDY_S3_PROXY_MODULE,
  CADDY_IMAGE,
  BUN_CACHE,
  GO_BUILD,
  GO_MOD,
  SOURCE_EXCLUDES,
} from "./constants";

import {
  PRISMA_BUN_SERVICE_START_COMMAND,
  MARIO_KART_ENTRYPOINT_COMMAND,
  buildImageHelper,
  buildCaddyS3ProxyImageHelper,
  buildObsidianHeadlessImageHelper,
  buildMcpGatewayImageHelper,
  buildScoutImageHelper,
  buildDiscordPlaysPokemonImageHelper,
  buildDiscordPlaysMarioKartImageHelper,
  buildTrmnlDashboardImageHelper,
} from "./image";

import versions from "./versions";

/** Build custom Caddy binary with s3-proxy plugin, using cached Go modules. */
function caddyS3ProxyBinary(): File {
  return dag
    .container()
    .from(CADDY_BUILDER_IMAGE)
    .withMountedCache("/go/pkg/mod", dag.cacheVolume(GO_MOD))
    .withMountedCache("/root/.cache/go-build", dag.cacheVolume(GO_BUILD))
    .withExec(["xcaddy", "build", "--with", CADDY_S3_PROXY_MODULE])
    .file("/usr/bin/caddy");
}

/** Generate and validate the Caddyfile for S3 static sites. */
export function caddyfileValidateHelper(source: Directory): Container {
  return dag
    .container()
    .from(BUN_IMAGE)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume(BUN_CACHE))
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source, { exclude: SOURCE_EXCLUDES })
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withWorkdir("/workspace/packages/homelab/src/cdk8s")
    .withExec(["bun", "install", "--frozen-lockfile"])
    .withExec([
      "sh",
      "-c",
      "bun run scripts/generate-caddyfile.ts > /tmp/Caddyfile",
    ])
    .withWorkdir("/workspace")
    .withFile("/usr/local/bin/caddy", caddyS3ProxyBinary())
    .withExec(["caddy", "validate", "--config", "/tmp/Caddyfile"]);
}

/** Start a container and verify its health endpoint responds. */
export function smokeTestHelper(
  image: Container,
  port: number = 3000,
  healthPath: string = "/",
  timeoutSeconds: number = 30,
): Container {
  const svc = image.withExposedPort(port).asService();

  return dag
    .container()
    .from(CADDY_IMAGE)
    .withServiceBinding("target", svc)
    .withExec([
      "sh",
      "-c",
      [
        `elapsed=0`,
        `while [ $elapsed -lt ${timeoutSeconds} ]; do`,
        `  if wget -q -O /dev/null "http://target:${port}${healthPath}"; then`,
        `    echo "Health check passed at ${healthPath} after ${"\u0024"}{elapsed}s"`,
        `    exit 0`,
        `  fi`,
        `  sleep 2`,
        `  elapsed=$((elapsed + 2))`,
        `done`,
        `echo "Health check timed out after ${timeoutSeconds}s"`,
        `exit 1`,
      ].join("\n"),
    ]);
}

// ---------------------------------------------------------------------------
// Per-package smoke tests — restore comprehensive startup verification
// ---------------------------------------------------------------------------

/**
 * Run a smoke test container and determine pass/fail from its exit code.
 *
 * - Exit 0 or 124 (timeout) → pass (service ran)
 * - Non-zero + expected auth/connection failure in output → pass
 * - Non-zero + unexpected failure → throw (fail fast)
 */
async function runSmokeTest(
  container: Container,
  expectedFailurePatterns: string[],
): Promise<string> {
  try {
    const output = await container.stdout();
    return `✅ Smoke test passed: process exited cleanly.\n\nOutput: ${output.slice(0, 500)}`;
  } catch (error) {
    // Dagger throws errors with exitCode/stdout/stderr for non-zero exits.
    // ExecError is not exported from the SDK, so check error shape with runtime validation.
    if (!(error instanceof Error)) throw error;
    const exitCode = "exitCode" in error ? Number(error.exitCode) : undefined;
    const stdout = "stdout" in error ? String(error.stdout) : "";
    const stderr = "stderr" in error ? String(error.stderr) : "";
    const propertyText = Object.getOwnPropertyNames(error)
      .map((propertyName) => String(Reflect.get(error, propertyName)))
      .join("\n");
    const combined =
      `${stdout}\n${stderr}\n${error.message}\n${String(error)}\n${propertyText}`.toLowerCase();
    const isExpected = expectedFailurePatterns.some((p) =>
      combined.includes(p.toLowerCase()),
    );

    if (isExpected) {
      return "✅ Smoke test passed: failed with expected auth error.";
    }

    if (exitCode === undefined) throw error;

    if (exitCode === 124) {
      return "✅ Smoke test passed: service ran until timeout.";
    }

    throw new Error(
      `Smoke test failed (exit code ${exitCode}).\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`,
    );
  }
}

/**
 * Smoke test scout-for-lol backend image.
 * Verifies: config loads, HTTP server starts, Discord auth fails as expected.
 */
export async function smokeTestScoutForLolHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  repoRoot: Directory | null = null,
): Promise<string> {
  const container = buildScoutImageHelper(pkgDir, depNames, depDirs, "dev", "unknown", repoRoot)
    .withEnvVariable("DISCORD_TOKEN", "smoke-test-dummy")
    .withEnvVariable("APPLICATION_ID", "000000000000000000")
    .withEnvVariable("RIOT_API_KEY", "smoke-test-dummy")
    .withEnvVariable("DATABASE_URL", "file:/tmp/smoke-test.db")
    .withEnvVariable("PORT", "3000")
    .withEntrypoint([])
    .withExec(["sh", "-c", "timeout 30s bun run src/index.ts 2>&1"]);

  return runSmokeTest(container, [
    "401",
    "TokenInvalid",
    "Unauthorized",
    "Invalid token",
  ]);
}

/**
 * Smoke test streambot image.
 * Verifies: ffmpeg + the baked yt-dlp are runnable; the real-ffmpeg subtitle integration suite passes
 * (sidecar detection, embedded text extraction, and a libass `subtitles=` burn — which needs the
 * image's ffmpeg+libass+fonts, absent from the plain test container); config validates; the playback
 * machine boots; and both Discord clients attempt login and fail with the expected auth error.
 */
export async function smokeTestStreambotHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  repoRoot: Directory | null = null,
): Promise<string> {
  const container = buildImageHelper(pkgDir, "streambot", depNames, depDirs, "dev", "unknown", false, false, repoRoot)
    .withEnvVariable("BOT_TOKEN", "smoke-test-dummy")
    .withEnvVariable("USER_TOKENS", "smoke-test-dummy")
    .withEnvVariable("ADMIN_IDS", "000000000000000000")
    .withEnvVariable("VIDEOS_DIR", "/tmp/videos")
    .withEntrypoint([])
    // Real-ffmpeg subtitle integration tests — a distinct exec so a non-zero exit hard-fails the
    // pipeline (no silent skip). This is the only place they run in CI: the plain `streambot: test`
    // container has no ffmpeg/libass.
    .withExec([
      "sh",
      "-c",
      "mkdir -p /tmp/videos && bun run test:integration 2>&1",
    ])
    .withExec([
      "sh",
      "-c",
      "ffmpeg -version && /usr/local/bin/yt-dlp --version && timeout 30s bun run src/index.ts 2>&1",
    ]);

  return runSmokeTest(container, [
    "tokeninvalid",
    "an invalid token was provided",
    "unauthorized",
    "401",
    "invalid token",
  ]);
}

/**
 * End-to-end test streambot with REAL credentials (run manually — it joins a real voice channel).
 * Builds the image, generates a short clip, drives it through the machine + selfbot streamer into
 * the configured voice channel, and asserts the run reaches `streaming` then stops. Software
 * encoding (no GPU in the build sandbox). Tokens are passed as Dagger Secrets.
 */
export async function e2eStreambotHelper(
  pkgDir: Directory,
  botToken: Secret,
  userToken: Secret,
  guildId: string,
  videoChannelId: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  repoRoot: Directory | null = null,
): Promise<string> {
  // USER_TOKENS is the real config (a single-token pool); E2E_* pin the voice channel the unattended
  // test joins (production joins the requester's current VC, which a headless test can't set).
  const container = buildImageHelper(pkgDir, "streambot", depNames, depDirs, "dev", "unknown", false, false, repoRoot)
    .withSecretVariable("BOT_TOKEN", botToken)
    .withSecretVariable("USER_TOKENS", userToken)
    .withEnvVariable("E2E_GUILD_ID", guildId)
    .withEnvVariable("E2E_VIDEO_CHANNEL_ID", videoChannelId)
    .withEnvVariable("VIDEOS_DIR", "/tmp/videos")
    .withEnvVariable("STREAM_HARDWARE_ACCELERATION", "false")
    .withEntrypoint([])
    .withExec(["sh", "-c", "mkdir -p /tmp/videos && bun run e2e/run.ts"]);
  return container.stdout();
}

/**
 * Smoke test birmel Discord bot image.
 * Verifies: config loads, Discord client attempts login, auth fails as expected.
 */
export async function smokeTestBirmelHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  repoRoot: Directory | null = null,
): Promise<string> {
  const container = buildImageHelper(
    pkgDir,
    pkg,
    depNames,
    depDirs,
    /* version */ "dev",
    /* gitSha */ "unknown",
    /* usePrisma */ true,
    /* installEditorClis */ true,
    repoRoot,
  )
    .withEnvVariable("DISCORD_TOKEN", "smoke-test-dummy")
    .withEnvVariable("DISCORD_CLIENT_ID", "smoke-test-dummy")
    .withEnvVariable("ANTHROPIC_API_KEY", "smoke-test-dummy")
    .withEnvVariable("OPENAI_API_KEY", "smoke-test-dummy")
    .withEnvVariable("DATABASE_URL", "file:/tmp/smoke-test.db")
    .withEnvVariable("MEMORY_DB_PATH", "file:/tmp/birmel-memory.db")
    .withEnvVariable("TELEMETRY_ENABLED", "false")
    .withEntrypoint([])
    .withExec([
      "sh",
      "-c",
      // Verify both CLIs are installed before launching the bot. If either is
      // missing the smoke test fails immediately rather than silently
      // shipping an image where the editor agent will warn at runtime. The
      // music checks cover the runtime dependencies discovered during the
      // Discord voice live patch: Node/Python for yt-dlp, ffmpeg-static for
      // audio transcoding, and @snazzah/davey for discord-voip DAVE support.
      [
        "command -v gh",
        "command -v claude",
        "node --version",
        "python3 --version",
        'bun -e "const ffmpegPath = require(\\"ffmpeg-static\\"); if (typeof ffmpegPath !== \\"string\\" || ffmpegPath.length === 0) throw new Error(\\"ffmpeg-static did not resolve\\");"',
        'bun -e "await import(\\"@snazzah/davey\\");"',
        "test -x node_modules/youtube-dl-exec/bin/yt-dlp",
        "timeout 10s node_modules/youtube-dl-exec/bin/yt-dlp --version",
        [
          "set +e",
          `output="$(timeout 30s ${PRISMA_BUN_SERVICE_START_COMMAND} 2>&1)"`,
          'status="$?"',
          "printf '%s\\n' \"$output\"",
          '[ "$status" -eq 0 ] && exit 0',
          '[ "$status" -eq 124 ] && exit 124',
          "printf '%s\\n' \"$output\" | grep -E 'TokenInvalid|401|Unauthorized|Invalid token'",
        ].join(" ; "),
      ].join(" && "),
    ]);

  return runSmokeTest(container, [
    "TokenInvalid",
    "401",
    "Unauthorized",
    "Invalid token",
  ]);
}

/**
 * Smoke test starlight-karma-bot image.
 * Verifies: config loads, server starts, Discord auth fails as expected.
 */
export async function smokeTestStarlightKarmaBotHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  repoRoot: Directory | null = null,
): Promise<string> {
  const container = buildImageHelper(pkgDir, pkg, depNames, depDirs, "dev", "unknown", false, false, repoRoot)
    .withEnvVariable("DISCORD_TOKEN", "smoke-test-dummy")
    .withEnvVariable("APPLICATION_ID", "000000000000000000")
    .withEnvVariable("DATA_DIR", "/tmp/smoke-data")
    .withEntrypoint([])
    .withExec(["mkdir", "-p", "/tmp/smoke-data"])
    .withExec(["sh", "-c", "timeout 30s bun run src/index.ts 2>&1"]);

  return runSmokeTest(container, [
    "TokenInvalid",
    "401",
    "Unauthorized",
    "Invalid token",
  ]);
}

/**
 * Smoke test tasknotes-server image.
 * Verifies: server starts and listens on the configured port.
 * No external auth required — server starts fully with defaults.
 */
export async function smokeTestTasknotesServerHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  repoRoot: Directory | null = null,
): Promise<string> {
  const container = buildImageHelper(pkgDir, pkg, depNames, depDirs, "dev", "unknown", false, false, repoRoot)
    .withEnvVariable("VAULT_PATH", "/tmp/smoke-vault")
    .withEnvVariable("AUTH_TOKEN", "smoke-test-token")
    .withEnvVariable("PORT", "3000")
    .withEntrypoint([])
    .withExec(["mkdir", "-p", "/tmp/smoke-vault"])
    .withExec(["sh", "-c", "timeout 10s bun run src/index.ts 2>&1"]);

  return runSmokeTest(container, []);
}

// ---------------------------------------------------------------------------
// New smoke tests — homelab infra images
// ---------------------------------------------------------------------------

/**
 * Smoke test caddy-s3proxy image.
 * Verifies: custom Caddy binary starts, includes s3proxy module, and can validate config.
 */
export async function smokeTestCaddyS3ProxyHelper(): Promise<string> {
  const container = buildCaddyS3ProxyImageHelper()
    .withEntrypoint([])
    // Verify version prints
    .withExec(["caddy", "version"])
    // Verify the s3-proxy module is compiled in
    .withExec([
      "sh",
      "-c",
      "caddy list-modules 2>&1 | grep -q s3proxy && echo 's3proxy module present' || (echo 'FATAL: s3proxy module missing'; exit 1)",
    ])
    // Verify Caddy can start and respond (validates the binary is functional)
    .withExec([
      "sh",
      "-c",
      "caddy start --config /dev/null 2>&1; sleep 1; caddy stop 2>&1; echo 'caddy start/stop OK'",
    ]);

  return runSmokeTest(container, []);
}

/**
 * Smoke test obsidian-headless image.
 *
 * Goal: give CI confidence that the built image will actually work in prod,
 * where it runs `ob sync-setup` → `ob sync --continuous` against a real vault.
 * All checks below are fully offline — no login, no remote vault, no network.
 *
 * Layer 1: CLI binary is installed and --help exits cleanly.
 * Layer 2: installed version matches the pin in versions.ts. Catches the
 *   "Dagger served a stale cached image" failure mode that #552 originally
 *   chased; without this, a cache short-circuit silently ships an outdated ob.
 * Layer 3: better-sqlite3 native addon loads AND round-trips a row. Runs
 *   from obsidian-headless's install dir so require() resolves via the same
 *   relative path the CLI uses at runtime (a bare `require('better-sqlite3')`
 *   from / cannot see a nested dep of a globally-installed package — that's
 *   the bug this test previously tripped on). Exercising the addon catches
 *   ABI mismatches and the Bun-runtime failure mode the original test aimed at.
 * Layer 4: `ob sync-list-local` on an empty vault. Exits 0 with "No vaults
 *   configured." when offline — exercises the CLI's sync/store init path,
 *   catching integration regressions the raw `require` test would miss.
 */
export async function smokeTestObsidianHeadlessHelper(): Promise<string> {
  const expectedVersion = versions["obsidian-headless"];

  const container = buildObsidianHeadlessImageHelper()
    .withEntrypoint([])
    .withEnvVariable("OBSIDIAN_HEADLESS_EXPECTED_VERSION", expectedVersion)
    // Layer 1 — CLI binary works.
    .withExec(["ob", "--help"])
    // Layer 2 — installed version matches the pin.
    .withExec([
      "sh",
      "-c",
      [
        "set -e",
        "actual=$(ob --version)",
        'if [ "$actual" != "$OBSIDIAN_HEADLESS_EXPECTED_VERSION" ]; then',
        '  echo "obsidian-headless version mismatch: installed=$actual expected=$OBSIDIAN_HEADLESS_EXPECTED_VERSION" >&2',
        "  exit 1",
        "fi",
        'echo "obsidian-headless version pinned: $actual"',
      ].join("\n"),
    ])
    // Layer 3 — better-sqlite3 native addon loads and functions.
    .withExec([
      "sh",
      "-c",
      [
        "set -e",
        'cd "$(npm root -g)/obsidian-headless"',
        "node -e \"const Database = require('better-sqlite3');" +
          " const db = new Database(':memory:');" +
          " db.exec('CREATE TABLE t (x INT)');" +
          " db.prepare('INSERT INTO t VALUES (?)').run(42);" +
          " if (db.prepare('SELECT x FROM t').get().x !== 42)" +
          " throw new Error('better-sqlite3 round-trip failed');" +
          " console.log('better-sqlite3 OK');\"",
      ].join("\n"),
    ])
    // Layer 4 — CLI sync/store init path works offline.
    .withExec(["mkdir", "-p", "/vault"])
    .withExec(["ob", "sync-list-local"]);

  return runSmokeTest(container, []);
}

/**
 * Smoke test the custom mcp-gateway image.
 * Verifies the runtime has Node, the prebuilt edstem-mcp entrypoint is present
 * and parses, and every production dependency survived `npm prune --omit=dev`.
 */
export async function smokeTestMcpGatewayHelper(): Promise<string> {
  const container = buildMcpGatewayImageHelper()
    .withEntrypoint([])
    // Layer 1 — Node runtime present (needed for `node /opt/edstem-mcp/dist/index.js`).
    .withExec(["node", "--version"])
    // Layer 2 — edstem-mcp entrypoint exists and parses.
    .withExec([
      "sh",
      "-c",
      [
        "set -e",
        "test -f /opt/edstem-mcp/dist/index.js",
        "node --check /opt/edstem-mcp/dist/index.js",
        'echo "edstem-mcp entrypoint OK"',
      ].join("\n"),
    ])
    // Layer 3 — every production dependency survived `npm prune --omit=dev`.
    // `node --check` only parses the entry; it never exercises the import graph,
    // so a prod dep misclassified as a devDependency upstream would pass syntax
    // checks yet crash the container on first real invocation. edstem-mcp is ESM,
    // so we verify dep presence directly rather than require()-ing the server
    // (which would start the stdio process and hang).
    .withExec([
      "node",
      "--input-type=module",
      "-e",
      [
        "import { readFileSync, existsSync } from 'node:fs';",
        "const pkg = JSON.parse(readFileSync('/opt/edstem-mcp/package.json', 'utf8'));",
        "const deps = Object.keys(pkg.dependencies ?? {});",
        "const missing = deps.filter((d) => !existsSync(`/opt/edstem-mcp/node_modules/${d}`));",
        "if (missing.length) { console.error('missing prod deps after prune:', missing); process.exit(1); }",
        "console.log(`all ${deps.length} prod deps present after prune`);",
      ].join("\n"),
    ]);

  return runSmokeTest(container, []);
}

// ---------------------------------------------------------------------------
// New smoke tests — app images missing smoke tests
// ---------------------------------------------------------------------------

/**
 * Smoke test discord-plays-pokemon image.
 * Verifies: app boots, loads config, attempts Discord auth (expects failure).
 * Requires a valid config.toml to pass Zod validation.
 */
export async function smokeTestDiscordPlaysPokemonHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  repoRoot: Directory | null = null,
): Promise<string> {
  // Minimal config.toml that passes Zod validation but uses dummy tokens
  const configToml = `
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

  const container = buildDiscordPlaysPokemonImageHelper(
    pkgDir,
    depNames,
    depDirs,
    "dev",
    "unknown",
    repoRoot,
  )
    .withEntrypoint([])
    // The app runs from the inner-monorepo root (see the image build), so
    // config.toml + wasm + saves resolve relative to that CWD.
    .withNewFile(
      "/workspace/packages/discord-plays-pokemon/config.toml",
      configToml,
    )
    .withWorkdir("/workspace/packages/discord-plays-pokemon")
    .withExec([
      "sh",
      "-c",
      "timeout 30s bun packages/backend/src/index.ts 2>&1",
    ]);

  return runSmokeTest(container, [
    "TokenInvalid",
    "401",
    "Unauthorized",
    "Invalid token",
    "Used disallowed intents",
  ]);
}

/**
 * Smoke test discord-plays-mario-kart image.
 * Verifies: the image builds (incl. the emscripten N64Wasm stage), the app
 * boots, parses config, and attempts a Discord (selfbot) login that fails with
 * a dummy token. The emulator is disabled so no copyrighted ROM is needed — the
 * stream login is what exercises the Discord auth path.
 */
export async function smokeTestDiscordPlaysMarioKartHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  repoRoot: Directory | null = null,
): Promise<string> {
  // Minimal config.toml that passes Zod validation but uses dummy tokens.
  // emulator disabled (no ROM available in CI); stream enabled so the selfbot
  // login runs and rejects with TokenInvalid.
  const configToml = `
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

  const container = buildDiscordPlaysMarioKartImageHelper(
    pkgDir,
    depNames,
    depDirs,
    "dev",
    "unknown",
    repoRoot,
  )
    .withEntrypoint([])
    // The app runs from the inner-monorepo root (see the image build), so
    // config.toml + assets + saves resolve relative to that CWD.
    .withNewFile(
      "/workspace/packages/discord-plays-mario-kart/config.toml",
      configToml,
    )
    .withWorkdir("/workspace/packages/discord-plays-mario-kart")
    // Writable SQLite target for the `prisma db push` prelude (the real DB lives
    // on a PVC in prod; here any writable path works).
    .withEnvVariable("DATABASE_PATH", "/tmp/smoke-leaderboard.db")
    // Run the REAL container entrypoint (incl. the `prisma db push` prelude),
    // not just index.ts — otherwise a broken migration command in the entrypoint
    // (e.g. an unsupported Prisma flag) sails through the smoke test. If the push
    // fails, the container exits non-zero with the prisma error (no TokenInvalid)
    // and runSmokeTest throws. `timeout` bounds the index.ts run that follows.
    .withExec([
      "sh",
      "-c",
      `timeout 30s sh -c '${MARIO_KART_ENTRYPOINT_COMMAND}' 2>&1`,
    ]);

  return runSmokeTest(container, [
    "TokenInvalid",
    "401",
    "Unauthorized",
    "Invalid token",
    "Used disallowed intents",
  ]);
}

/**
 * Smoke test trmnl-dashboard image.
 * Verifies: Zod config parses with required env vars present, Bun.serve binds to port 3000.
 * No external auth attempted at boot — `timeout` kills the running server (exit 124 → pass).
 * Required env vars come from packages/trmnl-dashboard/src/config.ts (TRMNL_API_KEY, HA_TOKEN).
 */
export async function smokeTestTrmnlDashboardHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  repoRoot: Directory | null = null,
): Promise<string> {
  const container = buildTrmnlDashboardImageHelper(pkgDir, depNames, depDirs, "dev", "unknown", repoRoot)
    .withEnvVariable("TRMNL_API_KEY", "smoke-test-dummy")
    .withEnvVariable("HA_TOKEN", "smoke-test-dummy")
    .withEnvVariable("HA_URL", "http://127.0.0.1:9999")
    .withEntrypoint([])
    .withExec(["sh", "-c", "timeout 15s bun run src/index.ts 2>&1"]);

  return runSmokeTest(container, ["listening on :3000"]);
}
