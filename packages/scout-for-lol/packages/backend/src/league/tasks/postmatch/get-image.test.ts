/**
 * Tests for getImage function and its S3 integration
 *
 * These tests verify that generated images are properly saved to S3
 * as part of the post-match flow.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { MatchIdSchema } from "@scout-for-lol/data";

// Create S3 mock
const s3Mock = mockClient(S3Client);

// Note: We don't need to mock the report package functions since we're testing
// the S3 integration directly through the storage module

beforeEach(() => {
  Bun.env["S3_BUCKET_NAME"] = "test-bucket";
  s3Mock.reset();
});

afterEach(() => {
  s3Mock.reset();
});

describe("getImage S3 Integration", () => {
  test("saveImageToS3 is called for ranked matches", async () => {
    // Import the function we're testing
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    const matchId = MatchIdSchema.parse("NA1_RANKED_MATCH");
    const imageBuffer = new TextEncoder().encode("ranked-match-image");
    const queueType = "solo";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await saveImageToS3(MatchIdSchema.parse(matchId), imageBuffer, queueType, []);

    expect(s3Mock.calls().length).toBe(1);
    expect(result).toBeDefined();
    expect(result).toContain(matchId);
  });

  test("saveImageToS3 is called for arena matches", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    const matchId = MatchIdSchema.parse("NA1_ARENA_MATCH");
    const imageBuffer = new TextEncoder().encode("arena-match-image");
    const queueType = "arena";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await saveImageToS3(MatchIdSchema.parse(matchId), imageBuffer, queueType, []);

    expect(s3Mock.calls().length).toBe(1);
    expect(result).toBeDefined();

    const call = s3Mock.call(0);
    const command = call.args[0];
    if (command instanceof PutObjectCommand) {
      expect(command.input.Metadata?.["queueType"]).toBe("arena");
    }
  });

  test("image upload failure doesn't crash post-match flow", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    const matchId = MatchIdSchema.parse("NA1_FAILED_UPLOAD");
    const imageBuffer = new TextEncoder().encode("match-image");
    const queueType = "solo";

    // Simulate S3 failure
    s3Mock.on(PutObjectCommand).rejects(new Error("S3 service unavailable"));

    // The function should throw (caller catches it)
    await expect(saveImageToS3(matchId, imageBuffer, queueType, [])).rejects.toThrow(
      "Failed to save PNG NA1_FAILED_UPLOAD to S3",
    );
  });

  test.skip("handles missing S3 configuration gracefully", async () => {
    // Note: This test is skipped because the configuration module caches
    // environment variables on first load. See s3-image.test.ts for details.
    //
    // Expected behavior:
    // - When S3_BUCKET_NAME is not set, saveImageToS3 returns undefined
    // - No S3 calls are made
  });
});

describe("Image Buffer Handling", () => {
  test("passes image buffer correctly to S3", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    const matchId = MatchIdSchema.parse("NA1_BUFFER_TEST");
    const imageBuffer = new TextEncoder().encode("specific-image-data-12345");
    const queueType = "solo";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    await saveImageToS3(MatchIdSchema.parse(matchId), imageBuffer, queueType, []);

    const call = s3Mock.call(0);
    const command = call.args[0];

    // Verify the exact buffer is passed
    if (command instanceof PutObjectCommand) {
      expect(command.input.Body).toBe(imageBuffer);
      expect(command.input.Body instanceof Uint8Array).toBe(true);
    }
  });

  test("handles empty image buffer", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    const matchId = MatchIdSchema.parse("NA1_EMPTY_BUFFER");
    const imageBuffer = new Uint8Array(0);
    const queueType = "solo";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await saveImageToS3(MatchIdSchema.parse(matchId), imageBuffer, queueType, []);

    expect(s3Mock.calls().length).toBe(1);
    expect(result).toBeDefined();

    const call = s3Mock.call(0);
    const command = call.args[0];
    if (command instanceof PutObjectCommand) {
      const body = command.input.Body;
      let bodyLength = 0;
      if (body instanceof Uint8Array) {
        bodyLength = body.length;
      } else if (typeof body === "string") {
        bodyLength = body.length;
      }
      expect(bodyLength).toBe(0);
    }
  });
});

describe("Queue Type Handling", () => {
  const queueTypes = ["solo", "flex", "arena", "unknown", "normal", "aram"];

  for (const queueType of queueTypes) {
    test(`handles ${queueType} queue type correctly`, async () => {
      const { saveImageToS3 } = await import("../../../storage/s3.js");

      const matchId = `NA1_${queueType.toUpperCase()}_TEST`;
      const imageBuffer = new TextEncoder().encode(`${queueType}-image`);

      s3Mock.on(PutObjectCommand).resolves({
        $metadata: { httpStatusCode: 200 },
      });

      await saveImageToS3(MatchIdSchema.parse(matchId), imageBuffer, queueType, []);

      const call = s3Mock.call(0);
      const command = call.args[0];
      if (command instanceof PutObjectCommand) {
        expect(command.input.Metadata?.["queueType"]).toBe(queueType);
      }
    });
  }
});

describe("Match ID Handling", () => {
  test("handles various match ID formats", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    const matchIds = ["NA1_1234567890", "EUW1_9876543210", "KR_1111111111", "BR1_5555555555", "OC1_4444444444"];

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    for (const matchId of matchIds) {
      const imageBuffer = new TextEncoder().encode(`image-for-${matchId}`);
      const result = await saveImageToS3(MatchIdSchema.parse(matchId), imageBuffer, "solo", []);

      if (result) {
        expect(result).toContain(matchId);
        expect(result).toMatch(/^s3:\/\/test-bucket\/games\/\d{4}\/\d{2}\/\d{2}\/.*\/report\.png$/);
      }
    }
  });

  test("includes match ID in S3 key", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    const matchId = MatchIdSchema.parse("TEST_MATCH_ID_123");
    const imageBuffer = new TextEncoder().encode("image-data");

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    await saveImageToS3(MatchIdSchema.parse(matchId), imageBuffer, "solo", []);

    const call = s3Mock.call(0);
    const command = call.args[0];

    if (command instanceof PutObjectCommand) {
      expect(command.input.Key).toContain(matchId);
      expect(command.input.Key).toEndWith(`${matchId}/report.png`);
    }
  });
});

describe("Concurrent Uploads", () => {
  test("handles multiple concurrent image uploads", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const uploads = [
      saveImageToS3(MatchIdSchema.parse("NA1_CONCURRENT_1"), new TextEncoder().encode("image1"), "solo", []),
      saveImageToS3(MatchIdSchema.parse("NA1_CONCURRENT_2"), new TextEncoder().encode("image2"), "flex", []),
      saveImageToS3(MatchIdSchema.parse("NA1_CONCURRENT_3"), new TextEncoder().encode("image3"), "arena", []),
    ];

    const results = await Promise.all(uploads);

    expect(s3Mock.calls().length).toBe(3);
    expect(results).toHaveLength(3);

    // Verify each result is unique
    expect(results[0]).toContain("NA1_CONCURRENT_1");
    expect(results[1]).toContain("NA1_CONCURRENT_2");
    expect(results[2]).toContain("NA1_CONCURRENT_3");
  });

  test("one failed upload doesn't affect others", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    // First call fails, others succeed
    s3Mock
      .on(PutObjectCommand)
      .rejectsOnce(new Error("Temporary failure"))
      .resolves({
        $metadata: { httpStatusCode: 200 },
      });

    const upload1 = saveImageToS3(MatchIdSchema.parse("NA1_FAIL"), new TextEncoder().encode("image1"), "solo", []);
    const upload2 = saveImageToS3(MatchIdSchema.parse("NA1_SUCCESS_1"), new TextEncoder().encode("image2"), "solo", []);
    const upload3 = saveImageToS3(MatchIdSchema.parse("NA1_SUCCESS_2"), new TextEncoder().encode("image3"), "solo", []);

    const results = await Promise.allSettled([upload1, upload2, upload3]);

    expect(results[0]?.status).toBe("rejected");
    expect(results[1]?.status).toBe("fulfilled");
    expect(results[2]?.status).toBe("fulfilled");

    if (results[1]?.status === "fulfilled") {
      expect(results[1].value).toContain("NA1_SUCCESS_1");
    }
    if (results[2]?.status === "fulfilled") {
      expect(results[2].value).toContain("NA1_SUCCESS_2");
    }
  });
});

describe("ContentType and S3 Configuration", () => {
  test("sets correct ContentType for PNG images", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    const matchId = MatchIdSchema.parse("NA1_CONTENT_TYPE");
    const imageBuffer = new TextEncoder().encode("png-image-data");

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    await saveImageToS3(MatchIdSchema.parse(matchId), imageBuffer, "solo", []);

    const call = s3Mock.call(0);
    const command = call.args[0];

    if (command instanceof PutObjectCommand) {
      expect(command.input.ContentType).toBe("image/png");
    }
  });

  test.skip("uses correct S3 bucket from environment", async () => {
    // Note: This test is skipped because the configuration module caches
    // environment variables on first load. See s3-image.test.ts for details.
    //
    // Expected behavior:
    // - Uses the bucket name from S3_BUCKET_NAME environment variable
    // - Returns s3:// URL with the correct bucket name
  });
});
