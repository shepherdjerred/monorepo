/**
 * Test setup file - sets environment variables before any other imports
 * This must be loaded before the test file to ensure Prisma Client
 * is initialized with the correct database URL
 */
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Set up minimal test environment
process.env["DISCORD_TOKEN"] = "test-token";
process.env["DISCORD_CLIENT_ID"] = "test-client-id";
process.env["OPENAI_API_KEY"] = "test-key";
process.env["DATABASE_PATH"] = ":memory:";
process.env["DATABASE_URL"] = "file::memory:?cache=shared";
process.env["OPS_DATABASE_URL"] = "file:./data/test-ops.db";
process.env["SHELL_ENABLED"] = "true";
process.env["SCHEDULER_ENABLED"] = "true";
process.env["BROWSER_ENABLED"] = "true";
process.env["BROWSER_HEADLESS"] = "true";

// Ensure data directories exist
const dataDir = join(process.cwd(), "data");
const screenshotsDir = join(dataDir, "screenshots");
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });

// Push database schema (creates tables if they don't exist)
// Uses spawnSync with explicit args to avoid shell injection
spawnSync("bunx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
  stdio: "pipe",
  env: { ...process.env, DATABASE_URL: process.env["OPS_DATABASE_URL"] },
});
