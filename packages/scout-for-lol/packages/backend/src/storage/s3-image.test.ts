import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MatchIdSchema } from "@scout-for-lol/data";
import { saveImageToS3 } from "#src/storage/s3.ts";
import {
  currentUtcDatePath,
  getValidatedPutCommand,
  mockFailedPut,
  mockSuccessfulPut,
  resetS3TestState,
  s3Mock,
  setS3TestBucket,
} from "#src/storage/s3-test-helpers.ts";

async function uploadImage(
  matchIdValue: string,
  queueType = "solo",
  body = new TextEncoder().encode(`${queueType}-image-data`),
) {
  return saveImageToS3(MatchIdSchema.parse(matchIdValue), body, queueType, []);
}

beforeEach(resetS3TestState);
afterEach(resetS3TestState);

describe("saveImageToS3 success cases", () => {
  test("uploads an image with the expected parameters and URL", async () => {
    mockSuccessfulPut();

    const result = await uploadImage("NA1_1234567890");
    const command = getValidatedPutCommand();

    expect(s3Mock.calls()).toHaveLength(1);
    expect(command.input.Bucket).toBe("test-bucket");
    expect(command.input.ContentType).toBe("image/png");
    expect(result).toMatch(
      /^s3:\/\/test-bucket\/games\/\d{4}\/\d{2}\/\d{2}\/NA1_1234567890\/report\.png$/,
    );
    expect(result).toContain("NA1_1234567890");
  });

  test.each([
    {
      name: "arena",
      matchId: "NA1_9999999999",
      expectedKeyFragment: "NA1_9999999999",
    },
    {
      name: "flex",
      matchId: "EUW1_5555555555",
      expectedKeyFragment: "EUW1_5555555555",
    },
    {
      name: "unknown",
      matchId: "KR_1111111111",
      expectedKeyFragment: "KR_1111111111",
    },
  ])(
    "handles the $name queue",
    async ({ name, matchId, expectedKeyFragment }) => {
      mockSuccessfulPut();

      const result = await uploadImage(matchId, name);
      const command = getValidatedPutCommand();

      expect(s3Mock.calls()).toHaveLength(1);
      expect(command.input.Key).toContain(expectedKeyFragment);
      expect(command.input.Metadata?.["queueType"]).toBe(name);
      expect(result).toBeDefined();
    },
  );

  test("preserves a large image buffer", async () => {
    const imageBuffer = new Uint8Array(5 * 1024 * 1024);
    mockSuccessfulPut();

    await uploadImage("NA1_LARGE", "solo", imageBuffer);

    const body = getValidatedPutCommand().input.Body;
    expect(body).toBeInstanceOf(Uint8Array);
    if (body instanceof Uint8Array) {
      expect(body).toHaveLength(5 * 1024 * 1024);
    }
  });

  test("retains special characters in the key, metadata, and URL", async () => {
    const matchId = "NA1_1234567890_SPECIAL";
    mockSuccessfulPut();

    const result = await uploadImage(matchId);
    const command = getValidatedPutCommand();

    expect(command.input.Key).toContain(matchId);
    expect(command.input.Metadata?.["matchId"]).toBe(matchId);
    expect(result).toContain(matchId);
  });
});

describe("saveImageToS3 configuration", () => {
  test.each([
    { name: "missing", bucket: undefined, matchId: "NA1_NO_BUCKET" },
    { name: "empty", bucket: "", matchId: "NA1_EMPTY_BUCKET" },
  ])(
    "skips upload when S3_BUCKET_NAME is $name",
    async ({ bucket, matchId }) => {
      setS3TestBucket(bucket);
      mockSuccessfulPut();

      await expect(uploadImage(matchId)).resolves.toBeUndefined();
      expect(s3Mock.calls()).toHaveLength(0);
    },
  );
});

describe("saveImageToS3 error handling", () => {
  test.each([
    {
      matchId: "NA1_ERROR_CASE",
      failure: "S3 upload failed",
      expected: "Failed to save PNG NA1_ERROR_CASE to S3",
    },
    {
      matchId: "EUW1_SPECIFIC_ERROR",
      failure: "Network timeout",
      expected: "Failed to save PNG EUW1_SPECIFIC_ERROR to S3",
    },
  ])(
    "reports $matchId when upload fails",
    async ({ matchId, failure, expected }) => {
      mockFailedPut(failure);

      await expect(uploadImage(matchId)).rejects.toThrow(expected);
      expect(s3Mock.calls()).toHaveLength(3);
    },
  );

  test("returns a URL when the SDK resolves a non-200 response", async () => {
    mockSuccessfulPut(500);

    await expect(uploadImage("NA1_BAD_STATUS")).resolves.toBeDefined();
  });

  test("preserves the original error details", async () => {
    const matchId = "NA1_DETAILED_ERROR";
    mockFailedPut("Access Denied");

    await expect(uploadImage(matchId)).rejects.toThrow(
      "Failed to save PNG NA1_DETAILED_ERROR to S3: Access Denied",
    );
  });
});

describe("saveImageToS3 key and URL format", () => {
  test("uses today's date, a PNG extension, and an s3 URL", async () => {
    mockSuccessfulPut();

    const result = await uploadImage("NA1_DATE_TEST");
    const key = getValidatedPutCommand().input.Key;

    expect(key).toMatch(
      /^games\/\d{4}\/\d{2}\/\d{2}\/NA1_DATE_TEST\/report\.png$/,
    );
    expect(key).toContain(`games/${currentUtcDatePath()}/`);
    expect(key.endsWith(".png")).toBe(true);
    expect(result).toMatch(/^s3:\/\/test-bucket\/games\/.+\.png$/);
  });
});

describe("saveImageToS3 metadata", () => {
  test("records match, queue, and a recent upload timestamp", async () => {
    const beforeUpload = new Date();
    mockSuccessfulPut();

    await uploadImage("NA1_METADATA");
    const afterUpload = new Date();
    const metadata = getValidatedPutCommand().input.Metadata;
    const uploadedAt = metadata?.["uploadedAt"];

    expect(metadata?.["matchId"]).toBe("NA1_METADATA");
    expect(metadata?.["queueType"]).toBe("solo");
    expect(uploadedAt).toBeDefined();

    if (uploadedAt !== undefined) {
      const timestamp = new Date(uploadedAt).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(beforeUpload.getTime());
      expect(timestamp).toBeLessThanOrEqual(afterUpload.getTime());
    }
  });
});
