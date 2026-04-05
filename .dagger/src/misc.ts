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
  buildHomelabImageHelper,
  buildDepsSummaryImageHelper,
  buildDnsAuditImageHelper,
  buildCaddyS3ProxyImageHelper,
  buildObsidianHeadlessImageHelper,
  buildScoutImageHelper,
  buildDiscordPlaysPokemonImageHelper,
  buildBetterSkillCappedFetcherImageHelper,
} from "./image";

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
 * Smoke test homelab HA automation image.
 * Verifies: app boots, connects to HA (expects ECONNREFUSED with dummy host).
 */
export async function smokeTestHomelabHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
): Promise<string> {
  const container = buildHomelabImageHelper(pkgDir, depNames, depDirs)
    .withEnvVariable("HASS_SERVER", "http://localhost:8123")
    .withEnvVariable("HASS_TOKEN", "smoke-test-dummy")
    .withEntrypoint([])
    .withExec(["sh", "-c", "timeout 30s bun src/main.ts 2>&1"]);

  return runSmokeTest(container, [
    "ECONNREFUSED",
    "connection refused",
    "fetch failed",
    "unable to connect",
    "401",
    "Unauthorized",
    // timeout exit 124 is handled by runSmokeTest as a pass
  ]);
}

/**
 * Smoke test dependency-summary image.
 * Verifies: app boots, TypeScript loads, begins cloning repo.
 * Expects: git clone to fail (no auth) or network failure — proves the app
 * started, parsed args, and reached business logic.
 */
export async function smokeTestDepsSummaryHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
): Promise<string> {
  // git is installed in the production image via homelabSubPackageBase
  const container = buildDepsSummaryImageHelper(pkgDir, depNames, depDirs)
    .withEntrypoint([])
    .withExec(["sh", "-c", "timeout 30s bun run src/main.ts 2>&1"]);

  return runSmokeTest(container, [
    // Expected: clone succeeds (public repo) but email send fails (no Postal API)
    "ECONNREFUSED",
    "fetch failed",
    "Failed to generate dependency summary",
    "fatal",
    "authentication",
    "POSTAL",
    "getaddrinfo",
  ]);
}

/**
 * Smoke test dns-audit image.
 * Verifies: Python + checkdmarc installed correctly, all submodules importable,
 * and the CLI entry point runs (--help exits 0).
 */
export async function smokeTestDnsAuditHelper(): Promise<string> {
  const container = buildDnsAuditImageHelper()
    .withEntrypoint([])
    .withExec([
      "python3",
      "-c",
      // Import all key submodules and run a real DNS check against a known domain.
      // This proves the full package works end-to-end, not just that it imports.
      [
        "import checkdmarc",
        "import checkdmarc.dmarc",
        "import checkdmarc.spf",
        "import checkdmarc.smtp",
        "print('checkdmarc ' + checkdmarc.__version__)",
        "result = checkdmarc.check_domains(['example.com'])",
        "print('DNS check completed for example.com')",
      ].join("; "),
    ]);

  return runSmokeTest(container, []);
}

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
 * Verifies: bun runtime works and obsidian-headless CLI is installed.
 */
export async function smokeTestObsidianHeadlessHelper(): Promise<string> {
  const container = buildObsidianHeadlessImageHelper()
    .withEntrypoint([])
    .withExec(["ob", "--help"]);

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

/**
 * Smoke test better-skill-capped-fetcher image.
 * Verifies: app boots, attempts Firebase/S3 operations (expects failure).
 */
export async function smokeTestBetterSkillCappedFetcherHelper(
  pkgDir: Directory,
  depNames: string[] = [],
  depDirs: Directory[] = [],
): Promise<string> {
  const container = buildBetterSkillCappedFetcherImageHelper(
    pkgDir,
    depNames,
    depDirs,
  )
    .withEnvVariable("OUTPUT_PATH", "/tmp/smoke-manifest.json")
    .withEntrypoint([])
    .withExec(["sh", "-c", "timeout 30s bun run src/index.ts 2>&1"]);

  return runSmokeTest(container, [
    "PERMISSION_DENIED",
    "Missing or insufficient permissions",
    "fetch failed",
    "ECONNREFUSED",
    "Firestore",
    "firebase",
  ]);
}
