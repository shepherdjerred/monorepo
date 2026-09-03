import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RawMatchSchema, type RawMatch } from "@scout-for-lol/data";
import { saveMatchToS3 } from "#src/storage/s3.ts";
import {
  getValidatedPutCommand,
  mockFailedPut,
  mockSuccessfulPut,
  resetS3TestState,
  s3Mock,
  setS3TestBucket,
} from "#src/storage/s3-test-helpers.ts";

async function loadMatchFixture(): Promise<RawMatch> {
  const fixtureUrl = new URL(
    "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
    import.meta.url,
  );
  const json: unknown = await Bun.file(fixtureUrl).json();
  return RawMatchSchema.parse(json);
}

type KeyCase = {
  name: string;
  date: string;
  matchId: string;
  filename: string;
  expected: string;
};

const keyCases: KeyCase[] = [
  {
    name: "match key follows the game hierarchy",
    date: "2025-10-16T14:30:45Z",
    matchId: "NA1_1234567890",
    filename: "match.json",
    expected: "games/2025/10/16/NA1_1234567890/match.json",
  },
  {
    name: "match key pads single-digit dates",
    date: "2025-01-05T08:15:30Z",
    matchId: "EUW1_9876543210",
    filename: "match.json",
    expected: "games/2025/01/05/EUW1_9876543210/match.json",
  },
  {
    name: "match key retains its JSON extension",
    date: "2025-12-31T23:59:59Z",
    matchId: "KR_1111111111",
    filename: "match.json",
    expected: "games/2025/12/31/KR_1111111111/match.json",
  },
  {
    name: "image key follows the game hierarchy",
    date: "2025-10-16T14:30:45Z",
    matchId: "NA1_1234567890",
    filename: "report.png",
    expected: "games/2025/10/16/NA1_1234567890/report.png",
  },
  {
    name: "image key pads single-digit dates",
    date: "2025-01-05T08:15:30Z",
    matchId: "EUW1_9876543210",
    filename: "report.png",
    expected: "games/2025/01/05/EUW1_9876543210/report.png",
  },
  {
    name: "image key retains its PNG extension",
    date: "2025-12-31T23:59:59Z",
    matchId: "KR_1111111111",
    filename: "report.png",
    expected: "games/2025/12/31/KR_1111111111/report.png",
  },
  {
    name: "SVG key follows the game hierarchy",
    date: "2025-10-16T14:30:45Z",
    matchId: "NA1_1234567890",
    filename: "report.svg",
    expected: "games/2025/10/16/NA1_1234567890/report.svg",
  },
  {
    name: "SVG key pads single-digit dates",
    date: "2025-01-05T08:15:30Z",
    matchId: "EUW1_9876543210",
    filename: "report.svg",
    expected: "games/2025/01/05/EUW1_9876543210/report.svg",
  },
  {
    name: "SVG key retains its SVG extension",
    date: "2025-12-31T23:59:59Z",
    matchId: "KR_1111111111",
    filename: "report.svg",
    expected: "games/2025/12/31/KR_1111111111/report.svg",
  },
  {
    name: "match key retains special match-id characters",
    date: "2025-10-16T14:30:45Z",
    matchId: "NA1_1234567890_SPECIAL",
    filename: "match.json",
    expected: "games/2025/10/16/NA1_1234567890_SPECIAL/match.json",
  },
  {
    name: "image key retains special match-id characters",
    date: "2025-10-16T14:30:45Z",
    matchId: "EUW1_9876543210_TEST",
    filename: "report.png",
    expected: "games/2025/10/16/EUW1_9876543210_TEST/report.png",
  },
];

function buildFixtureKey({
  date,
  matchId,
  filename,
}: Omit<KeyCase, "name" | "expected">): string {
  const parsed = new Date(date);
  const year = parsed.getUTCFullYear().toString();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `games/${year}/${month}/${day}/${matchId}/${filename}`;
}

beforeEach(resetS3TestState);
afterEach(resetS3TestState);

describe("S3 key generation logic", () => {
  test.each(keyCases)("$name", ({ expected, ...input }) => {
    expect(buildFixtureKey(input)).toBe(expected);
  });

  test("match, PNG, and SVG keys share one game directory", () => {
    const input = {
      date: "2025-10-16T14:30:45Z",
      matchId: "NA1_1234567890",
    };
    const matchKey = buildFixtureKey({ ...input, filename: "match.json" });
    const pngKey = buildFixtureKey({ ...input, filename: "report.png" });
    const svgKey = buildFixtureKey({ ...input, filename: "report.svg" });
    const directory = "games/2025/10/16/NA1_1234567890/";

    expect(matchKey.startsWith(directory)).toBe(true);
    expect(pngKey.startsWith(directory)).toBe(true);
    expect(svgKey.startsWith(directory)).toBe(true);
    expect(matchKey).not.toBe(pngKey);
    expect(pngKey.replace(".png", ".svg")).toBe(svgKey);
  });

  test.each([
    ["2025-01-01T00:00:00Z", "games/2025/01/01/TEST_123/match.json"],
    ["2025-06-15T12:00:00Z", "games/2025/06/15/TEST_123/match.json"],
    ["2025-12-31T23:59:59Z", "games/2025/12/31/TEST_123/match.json"],
  ])("formats every date component for %s", (date, expected) => {
    expect(
      buildFixtureKey({ date, matchId: "TEST_123", filename: "match.json" }),
    ).toBe(expected);
  });
});

describe("S3 match storage", () => {
  test("uploads JSON with the expected key, body, and metadata", async () => {
    const match = await loadMatchFixture();
    mockSuccessfulPut();

    await saveMatchToS3(match, ["Lord ARKΞV", "H6 Hadès"]);

    expect(s3Mock.calls()).toHaveLength(1);
    const command = getValidatedPutCommand();
    const matchId = match.metadata.matchId;

    expect(command.input.Bucket).toBe("test-bucket");
    expect(command.input.ContentType).toBe("application/json");
    expect(command.input.Key).toMatch(
      new RegExp(String.raw`^games/\d{4}/\d{2}/\d{2}/${matchId}/match\.json$`),
    );
    expect(command.input.Metadata?.["matchId"]).toBe(matchId);
    expect(command.input.Metadata?.["gameMode"]).toBe(match.info.gameMode);
    expect(command.input.Metadata?.["trackedPlayerCount"]).toBe("2");
    expect(command.input.Metadata).not.toHaveProperty("trackedPlayers");
    expect(command.input.Body).toBeInstanceOf(Uint8Array);

    if (command.input.Body instanceof Uint8Array) {
      const parsed: unknown = JSON.parse(
        new TextDecoder().decode(command.input.Body),
      );
      expect(RawMatchSchema.parse(parsed).metadata.matchId).toBe(matchId);
    }
  });

  test("skips upload when the bucket is absent", async () => {
    const match = await loadMatchFixture();
    setS3TestBucket(undefined);
    mockSuccessfulPut();

    await expect(saveMatchToS3(match, [])).resolves.toBe("skipped_no_bucket");
    expect(s3Mock.calls()).toHaveLength(0);
  });

  test("retries and reports match context when upload fails", async () => {
    const match = await loadMatchFixture();
    mockFailedPut("S3 upload failed");

    await expect(saveMatchToS3(match, [])).rejects.toThrow(
      `Failed to save match ${match.metadata.matchId} to S3`,
    );
    expect(s3Mock.calls()).toHaveLength(3);
  });
});

describe("S3 URL format", () => {
  test("uses a parseable s3 URL with the expected bucket and key", () => {
    const url = "s3://my-bucket/games/2025/10/16/NA1_1234567890/report.png";
    const parts = url.replace("s3://", "").split("/");

    expect(url).toBe(
      "s3://my-bucket/games/2025/10/16/NA1_1234567890/report.png",
    );
    expect(url.startsWith("s3://")).toBe(true);
    expect(parts[0]).toBe("my-bucket");
    expect(parts.at(-1)).toBe("report.png");
  });
});
