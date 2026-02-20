/**
 * Test setup file - sets environment variables before any other imports
 * This must be loaded before the test file to ensure Prisma Client
 * is initialized with the correct database URL
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Set up minimal test environment
// Only set defaults if not already set (allows CI to override)
Bun.env["DISCORD_TOKEN"] ??= "test-token";
Bun.env["DISCORD_CLIENT_ID"] ??= "test-client-id";
Bun.env["OPENAI_API_KEY"] ??= "test-key";
Bun.env["SHELL_ENABLED"] ??= "true";
Bun.env["SCHEDULER_ENABLED"] ??= "true";
Bun.env["BROWSER_ENABLED"] ??= "true";
Bun.env["BROWSER_HEADLESS"] ??= "true";

// If no database path is set (local dev), use a local file database
if (Bun.env["DATABASE_PATH"] == null || Bun.env["DATABASE_PATH"].length === 0) {
  const dataDir = path.join(process.cwd(), "data");
  await mkdir(dataDir, { recursive: true });
  const testDbPath = path.join(dataDir, "test-automation.db");
  Bun.env["DATABASE_PATH"] = testDbPath;
}

// Create screenshots directory
const screenshotsDir =
  Bun.env["BIRMEL_SCREENSHOTS_DIR"] ??
  path.join(process.cwd(), "data", "screenshots");
await mkdir(screenshotsDir, { recursive: true });
Bun.env["BIRMEL_SCREENSHOTS_DIR"] ??= screenshotsDir;

// Ensure database directory exists if it's a file-based database
const dbPath = Bun.env["DATABASE_PATH"] ?? "";
const normalizedDbPath = dbPath.startsWith("file:")
  ? dbPath.replace("file:", "")
  : dbPath;
if (normalizedDbPath) {
  await mkdir(path.dirname(normalizedDbPath), { recursive: true });
}

// Push database schema (creates tables if they don't exist)
// Uses spawnSync with explicit args to avoid shell injection
spawnSync(
  "bunx",
  ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"],
  {
    stdio: "pipe",
    env: {
      ...Bun.env,
      DATABASE_URL: dbPath.startsWith("file:") ? dbPath : `file:${dbPath}`,
    },
  },
);
