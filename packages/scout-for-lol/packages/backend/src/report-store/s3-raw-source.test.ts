import { describe, expect, test } from "bun:test";
import {
  type RawObjectKind,
  classifyRawObjectKey,
  matchObjectKey,
  prematchObjectKey,
  timelineObjectKey,
} from "#src/report-store/s3-raw-source.ts";

describe("classifyRawObjectKey", () => {
  const cases: [string, RawObjectKind][] = [
    ["games/2026/07/12/NA1_1/match.json", "match"],
    ["games/2026/07/12/NA1_1/timeline.json", "timeline"],
    ["prematch/2026/07/12/123/spectator-data.json", "prematch"],
    ["games/2026/07/12/NA1_1/report.png", "ignored"],
    ["games/2026/07/12/NA1_1/report.svg", "ignored"],
    ["failed-validations/2026/07/12/NA1_1/match.json", "ignored"],
    ["prematch/2026/07/12/123/loading-screen.png", "ignored"],
  ];
  test("classifies match/timeline/prematch keys and ignores the rest", () => {
    for (const [key, kind] of cases) {
      expect(classifyRawObjectKey(key)).toBe(kind);
    }
  });
});

describe("deterministic key builders (must mirror the live write paths)", () => {
  // Local-time construction so the date-fns `yyyy/MM/dd` (which formats in
  // local time, same as the write path) is timezone-independent in this test.
  const keyDate = new Date(2026, 6, 12, 12, 0, 0);

  test("match key mirrors storage/s3-helpers generateS3Key", () => {
    expect(matchObjectKey("NA1_123", keyDate)).toBe(
      "games/2026/07/12/NA1_123/match.json",
    );
  });

  test("timeline key mirrors storage/s3-helpers generateS3Key", () => {
    expect(timelineObjectKey("NA1_123", keyDate)).toBe(
      "games/2026/07/12/NA1_123/timeline.json",
    );
  });

  test("prematch key mirrors storage/s3-prematch generatePrematchS3Key", () => {
    expect(prematchObjectKey("456", keyDate)).toBe(
      "prematch/2026/07/12/456/spectator-data.json",
    );
  });
});
