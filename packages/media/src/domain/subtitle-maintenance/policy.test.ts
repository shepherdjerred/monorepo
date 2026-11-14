import { expect, test } from "vitest";
import {
  currentSubtitleUpgradeScoreV1,
  subtitleSearchDueV1,
} from "./policy.ts";
import { subtitleSourceScoreV1 } from "./score.ts";
const now = new Date("2026-11-14T12:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
test("wanted and upgrade honor the actual 6h and 12h settings", () => {
  for (const [mode, hours] of [
    ["wanted", 6],
    ["upgrade", 12],
  ] as const) {
    expect(
      subtitleSearchDueV1({
        mode,
        now,
        firstAttempt: ago(20),
        lastAttempt: ago(hours - 1),
      }),
    ).toBe(false);
    expect(
      subtitleSearchDueV1({
        mode,
        now,
        firstAttempt: ago(20),
        lastAttempt: ago(hours),
      }),
    ).toBe(true);
  }
});
test("adaptive retry is weekly after 21 days from first search, not publication age", () => {
  expect(
    subtitleSearchDueV1({
      mode: "wanted",
      now,
      firstAttempt: ago(21 * 24),
      lastAttempt: ago(24),
    }),
  ).toBe(false);
  expect(
    subtitleSearchDueV1({
      mode: "wanted",
      now,
      firstAttempt: ago(21 * 24),
      lastAttempt: ago(7 * 24),
    }),
  ).toBe(true);
  expect(
    subtitleSearchDueV1({
      mode: "wanted",
      now,
      firstAttempt: ago(20 * 24),
      lastAttempt: ago(6),
    }),
  ).toBe(true);
});
test("manual captions with genuine scores remain eligible only in the seven-day window", () => {
  const score = subtitleSourceScoreV1(
    {
      schemaVersion: 1,
      kind: "movie",
      title: "Example",
      year: 2026,
      season: null,
      episode: null,
      sourceFilename: "Example.2026.mkv",
      quality: null,
      videoCodec: null,
      audioCodec: null,
      imdbId: null,
      tmdbId: null,
      edition: "default",
    },
    { filename: "Example.2026.srt", hearingImpaired: false },
  );
  expect(
    currentSubtitleUpgradeScoreV1({
      createdAt: ago(7 * 24),
      now,
      matchingEvidence: { matchScoreV1: score, source: "manual" },
    }),
  ).toEqual(score);
  expect(
    currentSubtitleUpgradeScoreV1({
      createdAt: ago(7 * 24 + 1),
      now,
      matchingEvidence: { matchScoreV1: score },
    }),
  ).toBeNull();
  expect(
    currentSubtitleUpgradeScoreV1({
      createdAt: ago(1),
      now,
      matchingEvidence: { source: "manual" },
    }),
  ).toBeNull();
});
