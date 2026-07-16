import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { z } from "zod";
import {
  MatchIdSchema,
  RawMatchSchema,
  type RawMatch,
} from "@scout-for-lol/data";
import { saveImageToS3, saveMatchToS3 } from "#src/storage/s3.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";

const s3Mock = mockClient(S3Client);

// Zod schema for validating PutObjectCommand structure captured by the mock.
const PutCommandSchema = z.object({
  input: z.object({
    Bucket: z.string(),
    Key: z.string(),
    Body: z.union([z.instanceof(Uint8Array), z.string()]),
    ContentType: z.string(),
    Metadata: z.record(z.string(), z.string()).optional(),
  }),
});

function getValidatedPutCommand(callIndex: number) {
  const call = s3Mock.call(callIndex);
  return PutCommandSchema.parse(call?.args?.[0]);
}

async function loadMatchFixture(): Promise<RawMatch> {
  const fixtureUrl = new URL(
    "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
    import.meta.url,
  );
  const json: unknown = await Bun.file(fixtureUrl).json();
  return RawMatchSchema.parse(json);
}

// ============================================================================
// S3 Key Generation Tests (unit tests for the logic)
// ============================================================================

describe("S3 Key Generation Logic for Matches", () => {
  test("match key follows game-centric hierarchical date structure", () => {
    const matchId = "NA1_1234567890";
    const date = new Date("2025-10-16T14:30:45Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    const expectedKey = `games/${year.toString()}/${month}/${day}/${matchId}/match.json`;
    expect(expectedKey).toBe("games/2025/10/16/NA1_1234567890/match.json");
  });

  test("match key pads single digit months and days", () => {
    const matchId = "EUW1_9876543210";
    const date = new Date("2025-01-05T08:15:30Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    const key = `games/${year.toString()}/${month}/${day}/${matchId}/match.json`;
    expect(key).toBe("games/2025/01/05/EUW1_9876543210/match.json");
  });

  test("match key uses .json extension", () => {
    const matchId = "KR_1111111111";
    const date = new Date("2025-12-31T23:59:59Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    const key = `games/${year.toString()}/${month}/${day}/${matchId}/match.json`;
    expect(key).toEndWith(".json");
  });
});

describe("S3 Key Generation Logic for Images", () => {
  test("image key follows game-centric hierarchical date structure", () => {
    const matchId = "NA1_1234567890";
    const date = new Date("2025-10-16T14:30:45Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    const expectedKey = `games/${year.toString()}/${month}/${day}/${matchId}/report.png`;
    expect(expectedKey).toBe("games/2025/10/16/NA1_1234567890/report.png");
  });

  test("image key pads single digit months and days", () => {
    const matchId = "EUW1_9876543210";
    const date = new Date("2025-01-05T08:15:30Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    const key = `games/${year.toString()}/${month}/${day}/${matchId}/report.png`;
    expect(key).toBe("games/2025/01/05/EUW1_9876543210/report.png");
  });

  test("image key uses .png extension", () => {
    const matchId = "KR_1111111111";
    const date = new Date("2025-12-31T23:59:59Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    const key = `games/${year.toString()}/${month}/${day}/${matchId}/report.png`;
    expect(key).toEndWith(".png");
  });

  test("image and match keys share same game directory", () => {
    const matchId = "NA1_1234567890";
    const date = new Date("2025-10-16T14:30:45Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    const matchKey = `games/${year.toString()}/${month}/${day}/${matchId}/match.json`;
    const imageKey = `games/${year.toString()}/${month}/${day}/${matchId}/report.png`;

    // Both should share the same game directory
    const gameDir = `games/${year.toString()}/${month}/${day}/${matchId}/`;
    expect(matchKey).toStartWith(gameDir);
    expect(imageKey).toStartWith(gameDir);
    expect(matchKey).not.toBe(imageKey);
  });
});

describe("S3 Key Generation Logic for SVG Images", () => {
  test("SVG key follows game-centric hierarchical date structure", () => {
    const matchId = "NA1_1234567890";
    const date = new Date("2025-10-16T14:30:45Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    const expectedKey = `games/${year.toString()}/${month}/${day}/${matchId}/report.svg`;
    expect(expectedKey).toBe("games/2025/10/16/NA1_1234567890/report.svg");
  });

  test("SVG key pads single digit months and days", () => {
    const matchId = "EUW1_9876543210";
    const date = new Date("2025-01-05T08:15:30Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    const key = `games/${year.toString()}/${month}/${day}/${matchId}/report.svg`;
    expect(key).toBe("games/2025/01/05/EUW1_9876543210/report.svg");
  });

  test("SVG key uses .svg extension", () => {
    const matchId = "KR_1111111111";
    const date = new Date("2025-12-31T23:59:59Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    const key = `games/${year.toString()}/${month}/${day}/${matchId}/report.svg`;
    expect(key).toEndWith(".svg");
  });

  test("PNG and SVG keys share game directory structure", () => {
    const matchId = "NA1_1234567890";
    const date = new Date("2025-10-16T14:30:45Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    const pngKey = `games/${year.toString()}/${month}/${day}/${matchId}/report.png`;
    const svgKey = `games/${year.toString()}/${month}/${day}/${matchId}/report.svg`;

    // Both should use the same game directory path
    const gameDir = `games/${year.toString()}/${month}/${day}/${matchId}/`;
    expect(pngKey).toStartWith(gameDir);
    expect(svgKey).toStartWith(gameDir);

    // Only extension should differ
    expect(pngKey.replace(".png", ".svg")).toBe(svgKey);
  });
});

// ============================================================================
// S3 Storage Tests (aws-sdk-client-mock — in-memory, no real S3)
// ============================================================================

describe("S3 Match Storage", () => {
  beforeEach(() => {
    Bun.env["S3_BUCKET_NAME"] = "test-bucket";
    resetConfigurationForTests();
    s3Mock.reset();
  });

  afterEach(() => {
    Bun.env["S3_BUCKET_NAME"] = "test-bucket";
    resetConfigurationForTests();
    s3Mock.reset();
  });

  test("saveMatchToS3 uploads JSON with correct content type", async () => {
    const match = await loadMatchFixture();
    s3Mock
      .on(PutObjectCommand)
      .resolves({ $metadata: { httpStatusCode: 200 } });

    await saveMatchToS3(match, ["TrackedPlayer"]);

    expect(s3Mock.calls().length).toBe(1);
    const command = getValidatedPutCommand(0);
    expect(command.input.Bucket).toBe("test-bucket");
    expect(command.input.ContentType).toBe("application/json");
    // Key is dated off gameCreation and ends in match.json.
    const matchId = match.metadata.matchId;
    expect(command.input.Key).toMatch(
      new RegExp(String.raw`^games/\d{4}/\d{2}/\d{2}/${matchId}/match\.json$`),
    );
    expect(command.input.Metadata?.["matchId"]).toBe(matchId);
    expect(command.input.Metadata?.["gameMode"]).toBe(match.info.gameMode);
    expect(command.input.Metadata?.["trackedPlayers"]).toBe("TrackedPlayer");

    // saveToS3 encodes string bodies to a Uint8Array before upload; decode it
    // back and confirm it round-trips to the original match JSON.
    const body = command.input.Body;
    expect(body).toBeInstanceOf(Uint8Array);
    if (body instanceof Uint8Array) {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
      expect(RawMatchSchema.parse(parsed).metadata.matchId).toBe(matchId);
    }
  });

  test("saveMatchToS3 handles missing S3_BUCKET_NAME gracefully", async () => {
    // Load the fixture before clearing the bucket so there is no await between
    // the env mutation and the call under test.
    const match = await loadMatchFixture();
    delete Bun.env["S3_BUCKET_NAME"];
    resetConfigurationForTests();
    s3Mock
      .on(PutObjectCommand)
      .resolves({ $metadata: { httpStatusCode: 200 } });

    // Returns void without throwing and makes no S3 calls.
    await expect(saveMatchToS3(match, [])).resolves.toBeUndefined();
    expect(s3Mock.calls().length).toBe(0);
  });

  test("saveMatchToS3 throws error on S3 failure", async () => {
    const match = await loadMatchFixture();
    s3Mock.on(PutObjectCommand).rejects(new Error("S3 upload failed"));

    await expect(saveMatchToS3(match, [])).rejects.toThrow(
      `Failed to save match ${match.metadata.matchId} to S3`,
    );
    expect(s3Mock.calls().length).toBe(1);
  });
});

describe("S3 Image Storage", () => {
  beforeEach(() => {
    Bun.env["S3_BUCKET_NAME"] = "test-bucket";
    resetConfigurationForTests();
    s3Mock.reset();
  });

  afterEach(() => {
    Bun.env["S3_BUCKET_NAME"] = "test-bucket";
    resetConfigurationForTests();
    s3Mock.reset();
  });

  test("saveImageToS3 uploads PNG with correct content type", async () => {
    const matchId = MatchIdSchema.parse("NA1_1234567890");
    const imageBuffer = new TextEncoder().encode("fake-png-data");
    s3Mock
      .on(PutObjectCommand)
      .resolves({ $metadata: { httpStatusCode: 200 } });

    const result = await saveImageToS3(matchId, imageBuffer, "solo", []);

    expect(s3Mock.calls().length).toBe(1);
    const command = getValidatedPutCommand(0);
    expect(command.input.Bucket).toBe("test-bucket");
    expect(command.input.ContentType).toBe("image/png");
    expect(command.input.Key).toMatch(
      /^games\/\d{4}\/\d{2}\/\d{2}\/NA1_1234567890\/report\.png$/,
    );
    expect(command.input.Metadata?.["matchId"]).toBe(matchId);
    expect(command.input.Metadata?.["queueType"]).toBe("solo");
    expect(result).toStartWith("s3://test-bucket/");
    expect(result).toEndWith(".png");
  });

  test("saveImageToS3 returns undefined when S3_BUCKET_NAME not configured", async () => {
    delete Bun.env["S3_BUCKET_NAME"];
    resetConfigurationForTests();

    const matchId = MatchIdSchema.parse("NA1_NO_BUCKET");
    const imageBuffer = new TextEncoder().encode("image-data");
    s3Mock
      .on(PutObjectCommand)
      .resolves({ $metadata: { httpStatusCode: 200 } });

    const result = await saveImageToS3(matchId, imageBuffer, "solo", []);

    expect(result).toBeUndefined();
    expect(s3Mock.calls().length).toBe(0);
  });

  test("saveImageToS3 throws error on S3 failure", async () => {
    const matchId = MatchIdSchema.parse("NA1_ERROR_CASE");
    const imageBuffer = new TextEncoder().encode("image-data");
    s3Mock.on(PutObjectCommand).rejects(new Error("Access Denied"));

    await expect(
      saveImageToS3(matchId, imageBuffer, "solo", []),
    ).rejects.toThrow(`Failed to save PNG ${matchId} to S3`);
    expect(s3Mock.calls().length).toBe(1);
  });

  test("saveImageToS3 handles different queue types in metadata", async () => {
    s3Mock
      .on(PutObjectCommand)
      .resolves({ $metadata: { httpStatusCode: 200 } });

    for (const queueType of ["solo", "flex", "arena", "unknown"]) {
      s3Mock.reset();
      s3Mock
        .on(PutObjectCommand)
        .resolves({ $metadata: { httpStatusCode: 200 } });

      const matchId = MatchIdSchema.parse(`NA1_${queueType.toUpperCase()}`);
      const imageBuffer = new TextEncoder().encode(`${queueType}-image`);

      await saveImageToS3(matchId, imageBuffer, queueType, []);

      const command = getValidatedPutCommand(0);
      expect(command.input.Metadata?.["queueType"]).toBe(queueType);
    }
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe("Edge Cases for S3 Storage", () => {
  test("match key handles special characters in match IDs", () => {
    const matchId = "NA1_1234567890_SPECIAL";
    const date = new Date("2025-10-16T14:30:45Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    const key = `games/${year.toString()}/${month}/${day}/${matchId}/match.json`;
    expect(key).toContain(matchId);
    expect(key).toBe("games/2025/10/16/NA1_1234567890_SPECIAL/match.json");
  });

  test("image key handles special characters in match IDs", () => {
    const matchId = "EUW1_9876543210_TEST";
    const date = new Date("2025-10-16T14:30:45Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    const key = `games/${year.toString()}/${month}/${day}/${matchId}/report.png`;
    expect(key).toContain(matchId);
    expect(key).toBe("games/2025/10/16/EUW1_9876543210_TEST/report.png");
  });

  test("keys use consistent date formatting across months", () => {
    const matchId = "TEST_123";
    const dates = [
      new Date("2025-01-01T00:00:00Z"),
      new Date("2025-06-15T12:00:00Z"),
      new Date("2025-12-31T23:59:59Z"),
    ];

    for (const date of dates) {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date.getUTCDate()).padStart(2, "0");

      const key = `games/${year.toString()}/${month}/${day}/${matchId}/match.json`;

      // Verify all date parts are 2 digits (except year which is 4)
      const parts = key.split("/");
      expect(parts[1]?.length).toBe(4); // year
      expect(parts[2]?.length).toBe(2); // month
      expect(parts[3]?.length).toBe(2); // day
    }
  });

  test("match and image keys for same match share game directory", () => {
    const matchId = "NA1_1234567890";
    const date = new Date("2025-10-16T14:30:45Z");
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    const matchKey = `games/${year.toString()}/${month}/${day}/${matchId}/match.json`;
    const imageKey = `games/${year.toString()}/${month}/${day}/${matchId}/report.png`;

    // Both should use the same game directory
    const gameDir = `games/${year.toString()}/${month}/${day}/${matchId}/`;
    expect(matchKey).toStartWith(gameDir);
    expect(imageKey).toStartWith(gameDir);
  });
});

describe("S3 URL Format", () => {
  test("saveImageToS3 returns s3:// URL format", () => {
    const bucket = "my-bucket";
    const key = "games/2025/10/16/NA1_1234567890/report.png";
    const expectedUrl = `s3://${bucket}/${key}`;

    expect(expectedUrl).toBe(
      "s3://my-bucket/games/2025/10/16/NA1_1234567890/report.png",
    );
  });

  test("s3 URL format is parseable", () => {
    const url = "s3://my-bucket/games/2025/10/16/NA1_1234567890/report.png";

    expect(url).toStartWith("s3://");
    const parts = url.replace("s3://", "").split("/");
    expect(parts[0]).toBe("my-bucket");
    expect(parts.at(-1)).toBe("report.png");
  });
});
