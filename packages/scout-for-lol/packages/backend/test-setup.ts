/**
 * Test setup file - preloaded before all tests run
 * Configure test environment and global setup here
 */
import { tmpdir } from "node:os";

// Set test environment variables
Bun.env.NODE_ENV = "test";

// Set S3_BUCKET_NAME for tests that require it
// This must be set before the configuration module is imported
Bun.env["S3_BUCKET_NAME"] = "test-bucket";

// Isolate the report lake per test run: ingest paths (store.ts) write
// staging files via configuration.reportLakeDir, which must never land in
// the checkout during tests. Tests that need a lake of their own pass an
// explicit lakeDir instead of relying on this.
Bun.env["REPORT_LAKE_DIR"] =
  Bun.env["REPORT_LAKE_DIR"] ??
  `${tmpdir()}/scout-test-report-lake-${process.pid.toString()}`;

// Kill the AWS SDK's EC2 metadata (IMDS) credential probe. With no ambient
// AWS config (CI containers, fresh machines), the default credential chain
// falls through to IMDS at 169.254.169.254 — blackholed here, and under bun
// the probe's 1s timeout is not enforced, so any real S3 call hangs
// indefinitely. This was the root cause of the report-render "chart timeout"
// flake (main build 5035 hung the full 180s; deterministic repro with
// HOME pointed at an empty dir). There is no IMDS anywhere in this infra.
Bun.env["AWS_EC2_METADATA_DISABLED"] = "true";

// Stub URL pointing at a database that deliberately does not exist on the
// real server: tests that need real Prisma use createTestDatabase (or mock
// the client), and any accidental use of the production singleton fails
// loudly on first query instead of silently writing somewhere. The pg pool
// connects lazily, so merely importing `#src/database/index.ts` stays safe.
// Inline (no harness import) so the scout-root preload below stays cheap.
Bun.env["DATABASE_URL"] =
  Bun.env["DATABASE_URL"] ??
  `postgres://scout@127.0.0.1:${Bun.env["SCOUT_PG_PORT"] ?? "5471"}/scout_test_unbound`;

// Ensure the shared dev Postgres is up, sweep leaked test databases from
// crashed runs, and (re)build the scout_test_template database that
// createTestDatabase clones — for BACKEND test runs only. This file is also
// preloaded by the scout package root's bunfig.toml for its script suites,
// where importing the harness would require a running Postgres for pure
// script tests and drag @scout-for-lol/data into their coverage denominator
// (the package coverage gate measures every loaded file).
if (process.cwd() === import.meta.dir) {
  const { ensureTestTemplate, sweepStaleTestDatabases } =
    await import("./src/testing/test-template.ts");
  sweepStaleTestDatabases();
  await ensureTestTemplate();
}

// Deterministic HS256 signing secret for session-JWT tests (auth-web,
// jwt). Must be >= 32 chars (jwt.ts#getKey refuses shorter) and must be
// set before `configuration.ts` is imported, since it captures the value
// once at module load. This is a throwaway test key, never a real secret.
Bun.env["JWT_SIGNING_SECRET"] =
  Bun.env["JWT_SIGNING_SECRET"] ?? "test-jwt-signing-secret-0123456789abcdef";

// Any global test configuration can go here
