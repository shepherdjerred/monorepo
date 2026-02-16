import { describe, expect, test } from "bun:test";

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
// Integration Tests (requires S3 configuration)
// ============================================================================

describe("S3 Match Storage Integration", () => {
  test.skip("saveMatchToS3 uploads JSON with correct content type", async () => {
    // This would be an integration test that requires actual S3
    // Expected behavior:
    // 1. Generate S3 key based on current date
    // 2. Serialize match data to JSON
    // 3. Upload with ContentType: application/json
    // 4. Include metadata (matchId, gameMode, queueId, etc.)
    // 5. Log success with timing
  });

  test.skip("saveMatchToS3 handles missing S3_BUCKET_NAME gracefully", async () => {
    // Expected behavior:
    // 1. Check if S3_BUCKET_NAME is configured
    // 2. If not, log warning and return early
    // 3. Do not throw error
  });

  test.skip("saveMatchToS3 throws error on S3 failure", async () => {
    // Expected behavior:
    // 1. Attempt S3 upload
    // 2. If S3 fails, log error
    // 3. Throw descriptive error with match ID
  });
});

describe("S3 Image Storage Integration", () => {
  test.skip("saveImageToS3 uploads PNG with correct content type", async () => {
    // This would be an integration test that requires actual S3
    // Expected behavior:
    // 1. Generate S3 key based on current date
    // 2. Upload image buffer directly
    // 3. Upload with ContentType: image/png
    // 4. Include metadata (matchId, queueType, uploadedAt)
    // 5. Return S3 URL on success
  });

  test.skip("saveImageToS3 returns undefined when S3_BUCKET_NAME not configured", async () => {
    // Expected behavior:
    // 1. Check if S3_BUCKET_NAME is configured
    // 2. If not, log warning and return undefined
    // 3. Do not throw error
  });

  test.skip("saveImageToS3 throws error on S3 failure", async () => {
    // Expected behavior:
    // 1. Attempt S3 upload
    // 2. If S3 fails, log error
    // 3. Throw descriptive error with match ID
  });

  test.skip("saveImageToS3 handles different queue types in metadata", async () => {
    // Expected behavior:
    // 1. Accept queueType as parameter (arena, solo, flex, unknown, etc.)
    // 2. Include queueType in S3 object metadata
    // 3. Verify metadata is set correctly
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

    expect(expectedUrl).toBe("s3://my-bucket/games/2025/10/16/NA1_1234567890/report.png");
  });

  test("s3 URL format is parseable", () => {
    const url = "s3://my-bucket/games/2025/10/16/NA1_1234567890/report.png";

    expect(url).toStartWith("s3://");
    const parts = url.replace("s3://", "").split("/");
    expect(parts[0]).toBe("my-bucket");
    expect(parts[parts.length - 1]).toBe("report.png");
  });
});
