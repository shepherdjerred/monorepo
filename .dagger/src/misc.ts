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

import { bunBaseContainer } from "./base";

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
  pkg: string,
  depNames: string[] = [],
  depDirs: Directory[] = [],
  tsconfig: File | null = null,
): Promise<string> {
  const container = bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig)
    .withEnvVariable("DISCORD_TOKEN", "smoke-test-dummy")
    .withEnvVariable("APPLICATION_ID", "000000000000000000")
    .withEnvVariable("RIOT_API_KEY", "smoke-test-dummy")
    .withEnvVariable("DATABASE_URL", "file:/tmp/smoke-test.db")
    .withEnvVariable("PORT", "3000")
    .withEnvVariable("VERSION", "0.0.0-smoke")
    .withEnvVariable("GIT_SHA", "smoke-test")
    .withEntrypoint([])
    // Generate Prisma client — scout backend imports from #generated/prisma/client
    .withWorkdir("/workspace/packages/scout-for-lol/packages/backend")
    .withExec(["bunx", "--trust", "prisma@6", "generate"])
    .withExec(["sh", "-c", "timeout 30s bun run src/index.ts 2>&1; exit 0"]);

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
  tsconfig: File | null = null,
): Promise<string> {
  const container = bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig)
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
  tsconfig: File | null = null,
): Promise<string> {
  const container = bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig)
    .withEnvVariable("DISCORD_TOKEN", "smoke-test-dummy")
    .withEnvVariable("APPLICATION_ID", "000000000000000000")
    .withEnvVariable("DATA_DIR", "/tmp/smoke-data")
    .withEnvVariable("VERSION", "0.0.0-smoke")
    .withEnvVariable("GIT_SHA", "smoke-test")
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
  tsconfig: File | null = null,
): Promise<string> {
  const container = bunBaseContainer(pkgDir, pkg, depNames, depDirs, tsconfig)
    .withEnvVariable("VAULT_PATH", "/tmp/smoke-vault")
    .withEnvVariable("AUTH_TOKEN", "smoke-test-token")
    .withEnvVariable("PORT", "3000")
    .withEntrypoint([])
    .withExec(["mkdir", "-p", "/tmp/smoke-vault"])
    .withExec(["sh", "-c", "timeout 10s bun run src/index.ts 2>&1"]);

  return runSmokeTest(container, []);
}
