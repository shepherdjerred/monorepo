/**
 * Test setup file - sets environment variables before any other imports
 * This must be loaded before the test file to ensure Prisma Client
 * is initialized with the correct database URL
 */

// Set up minimal test environment
// Only set defaults if not already set (allows CI to override)
process.env["DISCORD_TOKEN"] ??= "test-token";
process.env["DISCORD_CLIENT_ID"] ??= "test-client-id";
process.env["OPENAI_API_KEY"] ??= "test-key";
process.env["DATABASE_PATH"] ??= ":memory:";
process.env["DATABASE_URL"] ??= "file::memory:?cache=shared";
process.env["OPS_DATABASE_URL"] ??= "file:./data/test-ops.db";
process.env["SHELL_ENABLED"] ??= "true";
process.env["SCHEDULER_ENABLED"] ??= "true";
process.env["BROWSER_ENABLED"] ??= "true";
process.env["BROWSER_HEADLESS"] ??= "true";
