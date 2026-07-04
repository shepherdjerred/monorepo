/**
 * Test setup file - preloaded before all tests run
 * Configure test environment and global setup here
 */

// Set test environment variables
Bun.env.NODE_ENV = "test";

// Set S3_BUCKET_NAME for tests that require it
// This must be set before the configuration module is imported
Bun.env["S3_BUCKET_NAME"] = "test-bucket";

// Kill the AWS SDK's EC2 metadata (IMDS) credential probe. With no ambient
// AWS config (CI containers, fresh machines), the default credential chain
// falls through to IMDS at 169.254.169.254 — blackholed here, and under bun
// the probe's 1s timeout is not enforced, so any real S3 call hangs
// indefinitely. This was the root cause of the report-render "chart timeout"
// flake (main build 5035 hung the full 180s; deterministic repro with
// HOME pointed at an empty dir). There is no IMDS anywhere in this infra.
Bun.env["AWS_EC2_METADATA_DISABLED"] = "true";

// SQLite stub URL — tests that need real Prisma should mock the client.
// Without this, modules that eagerly import `#src/database/index.ts` fail
// with PrismaClientInitializationError before any mock can intercept them.
Bun.env["DATABASE_URL"] = Bun.env["DATABASE_URL"] ?? "file:./test.db";

// Deterministic HS256 signing secret for session-JWT tests (auth-web,
// jwt). Must be >= 32 chars (jwt.ts#getKey refuses shorter) and must be
// set before `configuration.ts` is imported, since it captures the value
// once at module load. This is a throwaway test key, never a real secret.
Bun.env["JWT_SIGNING_SECRET"] =
  Bun.env["JWT_SIGNING_SECRET"] ?? "test-jwt-signing-secret-0123456789abcdef";

// Any global test configuration can go here
