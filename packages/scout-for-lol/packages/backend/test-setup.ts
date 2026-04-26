/**
 * Test setup file - preloaded before all tests run
 * Configure test environment and global setup here
 */

// Set test environment variables
Bun.env.NODE_ENV = "test";

// Set S3_BUCKET_NAME for tests that require it
// This must be set before the configuration module is imported
Bun.env["S3_BUCKET_NAME"] = "test-bucket";

// SQLite stub URL — tests that need real Prisma should mock the client.
// Without this, modules that eagerly import `#src/database/index.ts` fail
// with PrismaClientInitializationError before any mock can intercept them.
Bun.env["DATABASE_URL"] = Bun.env["DATABASE_URL"] ?? "file:./test.db";

// Any global test configuration can go here
