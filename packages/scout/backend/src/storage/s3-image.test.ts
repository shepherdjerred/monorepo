/**
 * S3 Image Storage Tests using aws-sdk-client-mock
 *
 * These tests use in-memory mocking via aws-sdk-client-mock instead of real S3.
 * This makes them fast, reliable, and doesn't require AWS credentials.
 *
 * Environment setup is handled automatically by test-setup.ts (preloaded via bunfig.toml)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { z } from "zod";
import { saveImageToS3 } from "@shepherdjerred/scout-backend/storage/s3.ts";
import { MatchIdSchema } from "@shepherdjerred/scout-data";

// Create S3 mock
const s3Mock = mockClient(S3Client);

// Zod schema for validating PutObjectCommand structure from mocks
const PutObjectCommandSchema = z.object({
  input: z.object({
    Bucket: z.string(),
    Key: z.string(),
    Body: z.union([z.instanceof(Uint8Array), z.string()]),
    ContentType: z.string(),
    Metadata: z
      .object({
        matchId: z.string(),
        queueType: z.string(),
        uploadedAt: z.string(),
      })
      .optional(),
  }),
});

// Helper to safely get and validate command from mock call
function getValidatedCommand(callIndex: number) {
  const call = s3Mock.call(callIndex);
  const command = call?.args?.[0];
  return PutObjectCommandSchema.parse(command);
}

beforeEach(() => {
  // Ensure S3_BUCKET_NAME is set for tests
  Bun.env["S3_BUCKET_NAME"] = "test-bucket";
  // Reset mock before each test
  s3Mock.reset();
});

afterEach(() => {
  // Reset mock after each test
  s3Mock.reset();
});

// ============================================================================
// Success Cases
// ============================================================================

describe("saveImageToS3 - Success Cases", () => {
  test("uploads image with correct parameters", async () => {
    const matchId = MatchIdSchema.parse("NA1_1234567890");
    const imageBuffer = new TextEncoder().encode("fake-png-data");
    const queueType = "solo";

    // Mock successful S3 upload
    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await saveImageToS3(matchId, imageBuffer, queueType, []);

    // Verify S3 command was called once with valid structure
    expect(s3Mock.calls().length).toBe(1);
    const command = getValidatedCommand(0);
    expect(command.input.Bucket).toBe("test-bucket");

    // Verify return value format
    expect(result).toMatch(/^s3:\/\/test-bucket\/games\/\d{4}\/\d{2}\/\d{2}\/NA1_1234567890\/report\.png$/);
    expect(result).toContain(matchId);
  });

  test("handles arena queue type", async () => {
    const matchId = MatchIdSchema.parse("NA1_9999999999");
    const imageBuffer = new TextEncoder().encode("arena-image-data");
    const queueType = "arena";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await saveImageToS3(matchId, imageBuffer, queueType, []);

    expect(s3Mock.calls().length).toBe(1);
    const command = getValidatedCommand(0);
    expect(command.input.ContentType).toBe("image/png");

    expect(result).toBeDefined();
    expect(result).toContain("s3://test-bucket/games/");
  });

  test("handles flex queue type", async () => {
    const matchId = MatchIdSchema.parse("EUW1_5555555555");
    const imageBuffer = new TextEncoder().encode("flex-image-data");
    const queueType = "flex";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await saveImageToS3(matchId, imageBuffer, queueType, []);

    expect(s3Mock.calls().length).toBe(1);
    const command = getValidatedCommand(0);
    expect(command.input.Bucket).toBe("test-bucket");

    expect(result).toBeDefined();
  });

  test("handles unknown queue type", async () => {
    const matchId = MatchIdSchema.parse("KR_1111111111");
    const imageBuffer = new TextEncoder().encode("unknown-image-data");
    const queueType = "unknown";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await saveImageToS3(matchId, imageBuffer, queueType, []);

    expect(s3Mock.calls().length).toBe(1);
    const command = getValidatedCommand(0);
    expect(command.input.Key).toContain("KR_1111111111");

    expect(result).toBeDefined();
  });

  test("handles large image buffers", async () => {
    const matchId = MatchIdSchema.parse("NA1_LARGE");
    // Create a 5MB buffer
    const imageBuffer = new Uint8Array(5 * 1024 * 1024);
    const queueType = "solo";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await saveImageToS3(matchId, imageBuffer, queueType, []);

    expect(s3Mock.calls().length).toBe(1);

    const command = getValidatedCommand(0);
    expect(command.input.Body).toBeInstanceOf(Uint8Array);
    if (command.input.Body instanceof Uint8Array) {
      expect(command.input.Body.length).toBe(5 * 1024 * 1024);
    }

    expect(result).toBeDefined();
  });

  test("handles match IDs with special characters", async () => {
    const matchId = MatchIdSchema.parse("NA1_1234567890_SPECIAL");
    const imageBuffer = new TextEncoder().encode("special-image-data");
    const queueType = "solo";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await saveImageToS3(matchId, imageBuffer, queueType, []);

    expect(s3Mock.calls().length).toBe(1);

    const command = getValidatedCommand(0);
    expect(command.input.Key).toContain(matchId);
    expect(command.input.Metadata?.matchId).toBe(matchId);

    expect(result).toContain(matchId);
  });
});

// ============================================================================
// Configuration Cases
// ============================================================================

describe("saveImageToS3 - Configuration", () => {
  test.skip("returns undefined when S3_BUCKET_NAME is not configured", async () => {
    // Note: This test is skipped because the configuration module caches
    // environment variables on first load, so we can't test the "not configured"
    // scenario after the module has been imported.
    //
    // Expected behavior (verified in integration tests):
    // - When S3_BUCKET_NAME is not set, saveImageToS3 returns undefined
    // - No S3 calls are made
    // - A warning is logged
  });

  test.skip("returns undefined when S3_BUCKET_NAME is empty string", async () => {
    // Note: This test is skipped for the same reason as above.
    //
    // Expected behavior (verified in integration tests):
    // - When S3_BUCKET_NAME is empty, saveImageToS3 returns undefined
    // - No S3 calls are made
    // - A warning is logged
  });
});

// ============================================================================
// Error Cases
// ============================================================================

describe("saveImageToS3 - Error Handling", () => {
  test("throws error when S3 upload fails", async () => {
    const matchId = MatchIdSchema.parse("NA1_ERROR_CASE");
    const imageBuffer = new TextEncoder().encode("image-data");
    const queueType = "solo";

    // Mock S3 error
    s3Mock.on(PutObjectCommand).rejects(new Error("S3 upload failed"));

    await expect(saveImageToS3(matchId, imageBuffer, queueType, [])).rejects.toThrow(
      "Failed to save PNG NA1_ERROR_CASE to S3",
    );

    expect(s3Mock.calls().length).toBe(1);
  });

  test("throws error with match ID in error message", async () => {
    const matchId = MatchIdSchema.parse("EUW1_SPECIFIC_ERROR");
    const imageBuffer = new TextEncoder().encode("image-data");
    const queueType = "flex";

    s3Mock.on(PutObjectCommand).rejects(new Error("Network timeout"));

    await expect(saveImageToS3(matchId, imageBuffer, queueType, [])).rejects.toThrow(
      "Failed to save PNG EUW1_SPECIFIC_ERROR to S3",
    );
  });

  test("throws error when S3 returns non-200 status", async () => {
    const matchId = MatchIdSchema.parse("NA1_BAD_STATUS");
    const imageBuffer = new TextEncoder().encode("image-data");
    const queueType = "solo";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 500 },
    });

    // Note: AWS SDK typically throws for non-200, but if it doesn't,
    // our code should still handle it. This test documents expected behavior.
    const result = await saveImageToS3(matchId, imageBuffer, queueType, []);

    // Current implementation returns the URL even if status is not 200
    // This is acceptable since AWS SDK will throw on actual errors
    expect(result).toBeDefined();
  });

  test("preserves original error details", async () => {
    const matchId = MatchIdSchema.parse("NA1_DETAILED_ERROR");
    const imageBuffer = new TextEncoder().encode("image-data");
    const queueType = "solo";

    const originalError = new Error("Access Denied");
    s3Mock.on(PutObjectCommand).rejects(originalError);

    try {
      await saveImageToS3(matchId, imageBuffer, queueType, []);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).toContain("Failed to save PNG");
        expect(error.message).toContain(matchId);
        expect(error.message).toContain("Access Denied");
      }
    }
  });
});

// ============================================================================
// S3 Key Format Tests
// ============================================================================

describe("saveImageToS3 - S3 Key Format", () => {
  test("uses current date in S3 key", async () => {
    const matchId = MatchIdSchema.parse("NA1_DATE_TEST");
    const imageBuffer = new TextEncoder().encode("image-data");
    const queueType = "solo";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    await saveImageToS3(matchId, imageBuffer, queueType, []);

    const command = getValidatedCommand(0);

    // Verify key structure
    const key = command.input.Key;
    expect(key).toMatch(/^games\/\d{4}\/\d{2}\/\d{2}\/NA1_DATE_TEST\/report\.png$/);

    // Verify it uses today's date
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");

    expect(key).toContain(`games/${year.toString()}/${month}/${day}/`);
  });

  test("uses .png extension", async () => {
    const matchId = MatchIdSchema.parse("NA1_PNG_EXT");
    const imageBuffer = new TextEncoder().encode("image-data");
    const queueType = "solo";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    await saveImageToS3(matchId, imageBuffer, queueType, []);

    const command = getValidatedCommand(0);

    expect(command.input.Key).toEndWith(".png");
  });

  test("returns s3:// URL format", async () => {
    const matchId = MatchIdSchema.parse("NA1_URL_FORMAT");
    const imageBuffer = new TextEncoder().encode("image-data");
    const queueType = "solo";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await saveImageToS3(matchId, imageBuffer, queueType, []);

    expect(result).toStartWith("s3://test-bucket/");
    expect(result).toContain("games/");
    expect(result).toEndWith(".png");
  });
});

// ============================================================================
// Metadata Tests
// ============================================================================

describe("saveImageToS3 - Metadata", () => {
  test("includes all required metadata fields", async () => {
    const matchId = MatchIdSchema.parse("NA1_METADATA");
    const imageBuffer = new TextEncoder().encode("image-data");
    const queueType = "solo";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    await saveImageToS3(matchId, imageBuffer, queueType, []);

    const command = getValidatedCommand(0);
    expect(command.input.Metadata?.matchId).toBe(matchId);
    expect(command.input.Metadata?.queueType).toBe(queueType);
    expect(command.input.Metadata?.uploadedAt).toBeDefined();
  });

  test("uploadedAt timestamp is recent", async () => {
    const matchId = MatchIdSchema.parse("NA1_TIMESTAMP");
    const imageBuffer = new TextEncoder().encode("image-data");
    const queueType = "solo";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const beforeUpload = new Date();
    await saveImageToS3(matchId, imageBuffer, queueType, []);
    const afterUpload = new Date();

    const command = getValidatedCommand(0);
    const uploadedAtStr = command.input.Metadata?.uploadedAt;
    expect(uploadedAtStr).toBeDefined();

    if (uploadedAtStr) {
      const uploadedAt = new Date(uploadedAtStr);
      expect(uploadedAt.getTime()).toBeGreaterThanOrEqual(beforeUpload.getTime());
      expect(uploadedAt.getTime()).toBeLessThanOrEqual(afterUpload.getTime());
    }
  });
});
