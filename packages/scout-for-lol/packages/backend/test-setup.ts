/**
 * Test setup file - preloaded before all tests run
 * Configure test environment and global setup here
 */

// Set test environment variables
Bun.env.NODE_ENV = "test";

// Set S3_BUCKET_NAME for tests that require it
// This must be set before the configuration module is imported
Bun.env["S3_BUCKET_NAME"] = "test-bucket";

// Any global test configuration can go here
