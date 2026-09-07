import { describe, expect, test } from "vitest";
import {
  buildMatchArtifactObjectKey,
  buildPrematchArtifactObjectKey,
} from "#src/artifacts/object-key.ts";
import { IsoInstantSchema, RiotMatchIdSchema } from "#src/identity/brands.ts";

function keyFor(args: {
  matchId: string;
  assetName: string;
  extension: string;
  capturedAt: string;
}): string {
  return buildMatchArtifactObjectKey({
    matchId: RiotMatchIdSchema.parse(args.matchId),
    assetName: args.assetName,
    extension: args.extension,
    capturedAt: IsoInstantSchema.parse(args.capturedAt),
  });
}

describe("buildMatchArtifactObjectKey", () => {
  test.each([
    {
      matchId: "NA1_1234567890",
      assetName: "match",
      extension: "json",
      capturedAt: "2025-10-16T12:00:00Z",
      expected: "games/2025/10/16/NA1_1234567890/match.json",
    },
    {
      matchId: "EUW1_9876543210",
      assetName: "match",
      extension: "json",
      capturedAt: "2025-01-05T08:30:00Z",
      expected: "games/2025/01/05/EUW1_9876543210/match.json",
    },
    {
      matchId: "KR_1111111111",
      assetName: "timeline",
      extension: "json",
      capturedAt: "2025-12-31T23:59:59Z",
      expected: "games/2025/12/31/KR_1111111111/timeline.json",
    },
    {
      matchId: "NA1_1234567890",
      assetName: "report",
      extension: "png",
      capturedAt: "2025-10-16T12:00:00Z",
      expected: "games/2025/10/16/NA1_1234567890/report.png",
    },
    {
      matchId: "NA1_1234567890",
      assetName: "report",
      extension: "svg",
      capturedAt: "2025-10-16T12:00:00Z",
      expected: "games/2025/10/16/NA1_1234567890/report.svg",
    },
  ])(
    "builds $expected",
    ({ matchId, assetName, extension, capturedAt, expected }) => {
      expect(keyFor({ matchId, assetName, extension, capturedAt })).toBe(
        expected,
      );
    },
  );

  test("zero-pads single-digit month and day segments", () => {
    expect(
      keyFor({
        matchId: "NA1_1234567890",
        assetName: "match",
        extension: "json",
        capturedAt: "2026-03-07T04:05:06Z",
      }),
    ).toBe("games/2026/03/07/NA1_1234567890/match.json");
  });

  test("keeps the UTC calendar date at the end of a UTC day", () => {
    expect(
      keyFor({
        matchId: "NA1_1234567890",
        assetName: "match",
        extension: "json",
        capturedAt: "2025-12-31T23:59:59Z",
      }),
    ).toBe("games/2025/12/31/NA1_1234567890/match.json");
    expect(
      keyFor({
        matchId: "NA1_1234567890",
        assetName: "match",
        extension: "json",
        capturedAt: "2026-01-01T00:00:00Z",
      }),
    ).toBe("games/2026/01/01/NA1_1234567890/match.json");
  });

  test("normalizes a positive-offset instant to its UTC calendar date", () => {
    expect(
      keyFor({
        matchId: "NA1_1234567890",
        assetName: "match",
        extension: "json",
        capturedAt: "2025-01-01T05:30:00+05:30",
      }),
    ).toBe("games/2025/01/01/NA1_1234567890/match.json");
    expect(
      keyFor({
        matchId: "NA1_1234567890",
        assetName: "match",
        extension: "json",
        capturedAt: "2025-01-01T00:30:00+05:30",
      }),
    ).toBe("games/2024/12/31/NA1_1234567890/match.json");
  });

  test("is deterministic for identical inputs", () => {
    const args = {
      matchId: "NA1_1234567890",
      assetName: "match",
      extension: "json",
      capturedAt: "2025-10-16T12:00:00Z",
    };
    expect(keyFor(args)).toBe(keyFor(args));
  });

  test.each([
    { assetName: "Match", reason: "uppercase" },
    { assetName: "match.json", reason: "embedded dot" },
    { assetName: "match_1", reason: "underscore" },
    { assetName: "-match", reason: "leading hyphen" },
    { assetName: "", reason: "empty" },
  ])("rejects asset name with $reason", ({ assetName }) => {
    expect(() =>
      keyFor({
        matchId: "NA1_1234567890",
        assetName,
        extension: "json",
        capturedAt: "2025-10-16T12:00:00Z",
      }),
    ).toThrow();
  });

  test.each([
    { extension: "JSON", reason: "uppercase" },
    { extension: "tar.gz", reason: "embedded dot" },
    { extension: "", reason: "empty" },
    { extension: "js on", reason: "whitespace" },
  ])("rejects extension with $reason", ({ extension }) => {
    expect(() =>
      keyFor({
        matchId: "NA1_1234567890",
        assetName: "match",
        extension,
        capturedAt: "2025-10-16T12:00:00Z",
      }),
    ).toThrow();
  });
});

function prematchKeyFor(args: {
  resourceId: string;
  assetName: string;
  extension: string;
  capturedAt: string;
}): string {
  return buildPrematchArtifactObjectKey({
    resourceId: args.resourceId,
    assetName: args.assetName,
    extension: args.extension,
    capturedAt: IsoInstantSchema.parse(args.capturedAt),
  });
}

describe("buildPrematchArtifactObjectKey", () => {
  // Expected keys mirror the canonical writer byte for byte:
  // backend/src/storage/s3-prematch.ts generatePrematchS3Key produces
  // `prematch/${yyyy/MM/dd}/${resourceId}/${assetType}.${extension}` with
  // resourceId defaulting to the spectator gameId as a string.
  test.each([
    {
      resourceId: "7123456789",
      assetName: "spectator-data",
      extension: "json",
      capturedAt: "2025-10-16T12:00:00Z",
      expected: "prematch/2025/10/16/7123456789/spectator-data.json",
    },
    {
      resourceId: "7123456789",
      assetName: "loading-screen",
      extension: "png",
      capturedAt: "2025-10-16T12:00:00Z",
      expected: "prematch/2025/10/16/7123456789/loading-screen.png",
    },
    {
      resourceId: "7123456789",
      assetName: "loading-screen",
      extension: "svg",
      capturedAt: "2025-01-05T08:30:00Z",
      expected: "prematch/2025/01/05/7123456789/loading-screen.svg",
    },
    {
      resourceId: "NA1_7123456789",
      assetName: "spectator-data",
      extension: "json",
      capturedAt: "2025-12-31T23:59:59Z",
      expected: "prematch/2025/12/31/NA1_7123456789/spectator-data.json",
    },
  ])(
    "builds $expected",
    ({ resourceId, assetName, extension, capturedAt, expected }) => {
      expect(
        prematchKeyFor({ resourceId, assetName, extension, capturedAt }),
      ).toBe(expected);
    },
  );

  test("normalizes an offset instant to its UTC calendar date", () => {
    expect(
      prematchKeyFor({
        resourceId: "7123456789",
        assetName: "spectator-data",
        extension: "json",
        capturedAt: "2025-01-01T00:30:00+05:30",
      }),
    ).toBe("prematch/2024/12/31/7123456789/spectator-data.json");
  });

  test("is deterministic for identical inputs", () => {
    const args = {
      resourceId: "7123456789",
      assetName: "spectator-data",
      extension: "json",
      capturedAt: "2025-10-16T12:00:00Z",
    };
    expect(prematchKeyFor(args)).toBe(prematchKeyFor(args));
  });

  test.each([
    { resourceId: "", reason: "empty" },
    { resourceId: "with/slash", reason: "path separator" },
    { resourceId: "with space", reason: "whitespace" },
    { resourceId: "_leading", reason: "leading underscore" },
    { resourceId: "id.dot", reason: "embedded dot" },
  ])("rejects resource id with $reason", ({ resourceId }) => {
    expect(() =>
      prematchKeyFor({
        resourceId,
        assetName: "spectator-data",
        extension: "json",
        capturedAt: "2025-10-16T12:00:00Z",
      }),
    ).toThrow();
  });
});
