/**
 * Tests for getImage function and its S3 integration
 *
 * These tests verify that generated images are properly saved to S3
 * as part of the post-match flow.
 */

import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/data";

// Create S3 mock
const s3Mock = mockClient(S3Client);

// Note: We don't need to mock the report package functions since we're testing
// the S3 integration directly through the storage module

beforeEach(() => {
  Bun.env["S3_BUCKET_NAME"] = "test-bucket";
  resetConfigurationForTests();
  s3Mock.reset();
});

afterEach(() => {
  // Restore the default bucket and drop any per-test configuration override so
  // the configuration singleton re-reads on next access.
  Bun.env["S3_BUCKET_NAME"] = "test-bucket";
  resetConfigurationForTests();
  s3Mock.reset();
});

describe("getImage S3 Integration", () => {
  test("saveImageToS3 is called for ranked matches", async () => {
    // Import the function we're testing
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    const matchId = RiotMatchIdSchema.parse("NA1_9100000110");
    const imageBuffer = new TextEncoder().encode("ranked-match-image");
    const queueType = "solo";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await saveImageToS3(matchId, imageBuffer, queueType, []);

    expect(s3Mock.calls().length).toBe(1);
    expect(result).toBeDefined();
    expect(result).toContain(matchId);
  });

  test("saveImageToS3 is called for arena matches", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    const matchId = RiotMatchIdSchema.parse("NA1_9100000000");
    const imageBuffer = new TextEncoder().encode("arena-match-image");
    const queueType = "arena";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await saveImageToS3(matchId, imageBuffer, queueType, []);

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

    const matchId = RiotMatchIdSchema.parse("NA1_9100000090");
    const imageBuffer = new TextEncoder().encode("match-image");
    const queueType = "solo";

    // Simulate S3 failure
    s3Mock.on(PutObjectCommand).rejects(new Error("S3 service unavailable"));

    // The function should throw (caller catches it)
    await expect(
      saveImageToS3(matchId, imageBuffer, queueType, []),
    ).rejects.toThrow("Failed to save PNG NA1_9100000090 to S3");
  });

  test("handles missing S3 configuration gracefully", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    delete Bun.env["S3_BUCKET_NAME"];
    resetConfigurationForTests();

    const matchId = RiotMatchIdSchema.parse("NA1_9100000100");
    const imageBuffer = new TextEncoder().encode("match-image");

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await saveImageToS3(matchId, imageBuffer, "solo", []);

    expect(result).toBeUndefined();
    expect(s3Mock.calls().length).toBe(0);
  });
});

describe("Image Buffer Handling", () => {
  test("passes image buffer correctly to S3", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    const matchId = RiotMatchIdSchema.parse("NA1_9100000010");
    const imageBuffer = new TextEncoder().encode("specific-image-data-12345");
    const queueType = "solo";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    await saveImageToS3(matchId, imageBuffer, queueType, []);

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

    const matchId = RiotMatchIdSchema.parse("NA1_9100000070");
    const imageBuffer = new Uint8Array(0);
    const queueType = "solo";

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await saveImageToS3(matchId, imageBuffer, queueType, []);

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

      const matchId = `NA1_${String(9_600_000_000 + queueTypes.indexOf(queueType))}`;
      const imageBuffer = new TextEncoder().encode(`${queueType}-image`);

      s3Mock.on(PutObjectCommand).resolves({
        $metadata: { httpStatusCode: 200 },
      });

      await saveImageToS3(
        RiotMatchIdSchema.parse(matchId),
        imageBuffer,
        queueType,
        [],
      );

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

    const matchIds = [
      "NA1_1234567890",
      "EUW1_9876543210",
      "KR_1111111111",
      "BR1_5555555555",
      "OC1_4444444444",
    ];

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    for (const matchId of matchIds) {
      const imageBuffer = new TextEncoder().encode(`image-for-${matchId}`);
      const result = await saveImageToS3(
        RiotMatchIdSchema.parse(matchId),
        imageBuffer,
        "solo",
        [],
      );

      if (result) {
        expect(result).toContain(matchId);
        expect(result).toMatch(
          /^s3:\/\/test-bucket\/games\/\d{4}\/\d{2}\/\d{2}\/.*\/report\.png$/,
        );
      }
    }
  });

  test("includes match ID in S3 key", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    const matchId = RiotMatchIdSchema.parse("NA1_9100000140");
    const imageBuffer = new TextEncoder().encode("image-data");

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    await saveImageToS3(matchId, imageBuffer, "solo", []);

    const call = s3Mock.call(0);
    const command = call.args[0];

    if (command instanceof PutObjectCommand) {
      const key = command.input.Key;
      if (key === undefined) throw new Error("Expected an S3 object key");
      expect(key).toContain(matchId);
      expect(key.endsWith(`${matchId}/report.png`)).toBe(true);
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
      saveImageToS3(
        RiotMatchIdSchema.parse("NA1_9100000020"),
        new TextEncoder().encode("image1"),
        "solo",
        [],
      ),
      saveImageToS3(
        RiotMatchIdSchema.parse("NA1_9100000030"),
        new TextEncoder().encode("image2"),
        "flex",
        [],
      ),
      saveImageToS3(
        RiotMatchIdSchema.parse("NA1_9100000040"),
        new TextEncoder().encode("image3"),
        "arena",
        [],
      ),
    ];

    const results = await Promise.all(uploads);

    expect(s3Mock.calls().length).toBe(3);
    expect(results).toHaveLength(3);

    // Verify each result is unique
    expect(results[0]).toContain("NA1_9100000020");
    expect(results[1]).toContain("NA1_9100000030");
    expect(results[2]).toContain("NA1_9100000040");
  });

  test("one failed upload doesn't affect others", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    // First call fails permanently (a 4xx is not retried), others succeed.
    // A transient error would be recovered by the PutObject retry, so use a
    // deterministic 403 to keep the "one failure is isolated" assertion valid.
    const permanentError = Object.assign(new Error("Access denied"), {
      $metadata: { httpStatusCode: 403 },
    });
    s3Mock
      .on(PutObjectCommand)
      .rejectsOnce(permanentError)
      .resolves({
        $metadata: { httpStatusCode: 200 },
      });

    const upload1 = saveImageToS3(
      RiotMatchIdSchema.parse("NA1_9100000080"),
      new TextEncoder().encode("image1"),
      "solo",
      [],
    );
    const upload2 = saveImageToS3(
      RiotMatchIdSchema.parse("NA1_9100000120"),
      new TextEncoder().encode("image2"),
      "solo",
      [],
    );
    const upload3 = saveImageToS3(
      RiotMatchIdSchema.parse("NA1_9100000130"),
      new TextEncoder().encode("image3"),
      "solo",
      [],
    );

    const results = await Promise.allSettled([upload1, upload2, upload3]);

    expect(results[0]?.status).toBe("rejected");
    expect(results[1]?.status).toBe("fulfilled");
    expect(results[2]?.status).toBe("fulfilled");

    if (results[1]?.status === "fulfilled") {
      expect(results[1].value).toContain("NA1_9100000120");
    }
    if (results[2]?.status === "fulfilled") {
      expect(results[2].value).toContain("NA1_9100000130");
    }
  });
});

describe("ContentType and S3 Configuration", () => {
  test("sets correct ContentType for PNG images", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    const matchId = RiotMatchIdSchema.parse("NA1_9100000050");
    const imageBuffer = new TextEncoder().encode("png-image-data");

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    await saveImageToS3(matchId, imageBuffer, "solo", []);

    const call = s3Mock.call(0);
    const command = call.args[0];

    if (command instanceof PutObjectCommand) {
      expect(command.input.ContentType).toBe("image/png");
    }
  });

  test("uses correct S3 bucket from environment", async () => {
    const { saveImageToS3 } = await import("../../../storage/s3.js");

    Bun.env["S3_BUCKET_NAME"] = "custom-scout-bucket";
    resetConfigurationForTests();

    const matchId = RiotMatchIdSchema.parse("NA1_9100000060");
    const imageBuffer = new TextEncoder().encode("png-image-data");

    s3Mock.on(PutObjectCommand).resolves({
      $metadata: { httpStatusCode: 200 },
    });

    const result = await saveImageToS3(matchId, imageBuffer, "solo", []);

    expect(s3Mock.calls().length).toBe(1);
    const call = s3Mock.call(0);
    const command = call.args[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    if (command instanceof PutObjectCommand) {
      expect(command.input.Bucket).toBe("custom-scout-bucket");
    }
    if (result === undefined) throw new Error("Expected an uploaded image URL");
    expect(result.startsWith("s3://custom-scout-bucket/")).toBe(true);
    expect(result).toContain(matchId);
  });
});
