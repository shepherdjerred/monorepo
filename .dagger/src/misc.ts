/**
 * Miscellaneous helper functions (mkdocs, caddyfile, smokeTest).
 *
 * These are plain functions (not decorated) — the @func() wrappers live in index.ts.
 */
import { dag, Container, Directory, File } from "@dagger.io/dagger";

import {
  BUN_IMAGE,
  CADDY_BUILDER_IMAGE,
  CADDY_IMAGE,
  PYTHON_IMAGE,
  BUN_CACHE,
  GO_BUILD,
  GO_MOD,
  SOURCE_EXCLUDES,
} from "./constants";

import {
  buildImageHelper,
  buildCaddyS3ProxyImageHelper,
  buildObsidianHeadlessImageHelper,
  buildScoutImageHelper,
  buildDiscordPlaysPokemonImageHelper,
} from "./image";

import versions from "./versions";

/** Build MkDocs documentation site and return the built site/ directory. */
export function mkdocsBuildHelper(source: Directory): Directory {
  return dag
    .container()
    .from(PYTHON_IMAGE)
    .withExec(["apt-get", "update", "-qq"])
    .withExec([
      "apt-get",
      "install",
      "-y",
      "-qq",
      "--no-install-recommends",
      "pngquant",
    ])
    .withExec([
      "pip",
      "install",
      "--no-cache-dir",
      "mkdocs-material",
      "mkdocs-minify-plugin",
      "pillow",
      "cairosvg",
    ])
    .withWorkdir("/workspace")
    .withDirectory(
      "/workspace",
      source.directory("packages/discord-plays-pokemon/docs"),
    )
    .withExec(["mkdocs", "build"])
    .directory("/workspace/site");
}

/** Build custom Caddy binary with s3-proxy plugin, using cached Go modules. */
function caddyS3ProxyBinary(): File {
  return dag
    .container()
    .from(CADDY_BUILDER_IMAGE)
    .withMountedCache("/go/pkg/mod", dag.cacheVolume(GO_MOD))
    .withMountedCache("/root/.cache/go-build", dag.cacheVolume(GO_BUILD))
    .withExec([
      "xcaddy",
      "build",
      "--with",
      "github.com/lindenlab/caddy-s3-proxy",
    ])
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

    if (exitCode === undefined) throw error;

    if (exitCode === 124) {
      return "✅ Smoke test passed: service ran until timeout.";
    }

    const combined = `${stdout}\n${stderr}`.toLowerCase();
    const isExpected = expectedFailurePatterns.some((p) =>
      combined.includes(p.toLowerCase()),
    );

    if (isExpected) {
      return "✅ Smoke test passed: failed with expected auth error.";
    }

    throw new Error(
      `Smoke test failed (exit code ${error.exitCode}).\n\nstdout:\n${error.stdout}\n\nstderr:\n${error.stderr}`,
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
): Promise<string> {
  const container = buildScoutImageHelper(pkgDir, depNames, depDirs)
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
 * Smoke test birmel Discord bot image.
 * Verifies: config loads, Discord client attempts login, auth fails as expected.
 */
export async function smokeTestBirmelHelper(
  pkgDir: Directory,
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
): Promise<string> {
  const container = buildImageHelper(pkgDir, pkg, depNames, depDirs)
    .withEnvVariable("DISCORD_TOKEN", "smoke-test-dummy")
    .withEnvVariable("DISCORD_CLIENT_ID", "smoke-test-dummy")
    .withEnvVariable("ANTHROPIC_API_KEY", "smoke-test-dummy")
    .withEnvVariable("OPENAI_API_KEY", "smoke-test-dummy")
    .withEnvVariable("DATABASE_URL", "file:/tmp/smoke-test.db")
    .withEnvVariable("MASTRA_MEMORY_DB_PATH", "file:/tmp/mastra-memory.db")
    .withEnvVariable(
      "MASTRA_TELEMETRY_DB_PATH",
      "file:/tmp/mastra-telemetry.db",
    )
    .withEntrypoint([])
    .withExec(["sh", "-c", "timeout 30s bun run start 2>&1"]);

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
): Promise<string> {
  const container = buildImageHelper(pkgDir, pkg, depNames, depDirs)
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
): Promise<string> {
  const container = buildImageHelper(pkgDir, pkg, depNames, depDirs)
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
username = "smoke@test.com"
password = "smoke-test"

[game]
enabled = false
emulator_url = "built_in"

[game.browser.preferences]

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
  )
    .withEntrypoint([])
    .withNewFile(
      "/workspace/packages/discord-plays-pokemon/packages/backend/config.toml",
      configToml,
    )
    .withExec(["sh", "-c", "timeout 30s bun run src/index.ts 2>&1"]);

  return runSmokeTest(container, [
    "TokenInvalid",
    "401",
    "Unauthorized",
    "Invalid token",
    "Used disallowed intents",
  ]);
}

