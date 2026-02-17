/**
 * Test setup file - sets environment variables before any other imports
 * This must be loaded before the test file to ensure Prisma Client
 * is initialized with the correct database URL
 */
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

// Set up minimal test environment
// Only set defaults if not already set (allows CI to override)
process.env["DISCORD_TOKEN"] ??= "test-token";
process.env["DISCORD_CLIENT_ID"] ??= "test-client-id";
process.env["OPENAI_API_KEY"] ??= "test-key";
process.env["SHELL_ENABLED"] ??= "true";
process.env["SCHEDULER_ENABLED"] ??= "true";
process.env["BROWSER_ENABLED"] ??= "true";
process.env["BROWSER_HEADLESS"] ??= "true";

// If no database path is set (local dev), use a local file database
if (process.env["DATABASE_PATH"] == null || process.env["DATABASE_PATH"].length === 0) {
  const dataDir = join(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  const testDbPath = join(dataDir, "test-automation.db");
  process.env["DATABASE_PATH"] = testDbPath;
}

// Create screenshots directory
const screenshotsDir =
  process.env["BIRMEL_SCREENSHOTS_DIR"] ??
  join(process.cwd(), "data", "screenshots");
mkdirSync(screenshotsDir, { recursive: true });
process.env["BIRMEL_SCREENSHOTS_DIR"] ??= screenshotsDir;

// Ensure database directory exists if it's a file-based database
const dbPath = process.env["DATABASE_PATH"] ?? "";
const normalizedDbPath = dbPath.startsWith("file:")
  ? dbPath.replace("file:", "")
  : dbPath;
if (normalizedDbPath) {
  mkdirSync(dirname(normalizedDbPath), { recursive: true });
}

// Push database schema (creates tables if they don't exist)
// Uses spawnSync with explicit args to avoid shell injection
spawnSync(
  "bunx",
  ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"],
  {
    stdio: "pipe",
    env: {
      ...process.env,
      DATABASE_URL: dbPath.startsWith("file:") ? dbPath : `file:${dbPath}`,
    },
  },
);
