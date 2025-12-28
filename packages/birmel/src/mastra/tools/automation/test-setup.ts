/**
 * Test setup file - sets environment variables before any other imports
 * This must be loaded before the test file to ensure Prisma Client
 * is initialized with the correct database URL
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

// Create directories needed by tests
const dataDir = join(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });

const screenshotsDir = join(dataDir, "screenshots");
mkdirSync(screenshotsDir, { recursive: true });

// Use a file-based test database (in-memory doesn't work across processes)
const testDbPath = join(dataDir, "test-automation.db");

// Remove old test database to start fresh
if (existsSync(testDbPath)) {
  try {
    unlinkSync(testDbPath);
  } catch {
    // Ignore errors - file may be in use
  }
}

// Set up minimal test environment
// Only set defaults if not already set (allows CI to override)
process.env["DISCORD_TOKEN"] ??= "test-token";
process.env["DISCORD_CLIENT_ID"] ??= "test-client-id";
process.env["OPENAI_API_KEY"] ??= "test-key";
process.env["DATABASE_PATH"] ??= testDbPath;
process.env["DATABASE_URL"] ??= `file:${testDbPath}`;
process.env["OPS_DATABASE_URL"] ??= `file:${testDbPath}`;
process.env["SHELL_ENABLED"] ??= "true";
process.env["SCHEDULER_ENABLED"] ??= "true";
process.env["BROWSER_ENABLED"] ??= "true";
process.env["BROWSER_HEADLESS"] ??= "true";
process.env["BIRMEL_SCREENSHOTS_DIR"] ??= screenshotsDir;

// Push the Prisma schema to the test database
// This creates all the necessary tables for the tests
const result = spawnSync("bunx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
  env: process.env,
  cwd: process.cwd(),
  stdio: "pipe",
});

if (result.status !== 0) {
  console.error("Failed to push Prisma schema:", result.stderr?.toString());
  process.exit(1);
}
