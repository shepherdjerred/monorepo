import { expect, it } from "vitest";
import {
  regularDialogueCovered,
  needsSubtitleTimingV1,
} from "./subtitle-speech.ts";

const videoChecksum = "a".repeat(64),
  subtitleChecksum = "b".repeat(64);
const full = {
  schemaVersion: 1,
  detector: "ffsubsync-0.5.1/webrtc",
  videoChecksum,
  subtitleChecksum,
  runtimeMs: 1_200_000,
  speechMs: 120_000,
  coveredSpeechMs: 114_000,
  windows: Array.from({ length: 12 }, () => ({
    speechMs: 10_000,
    coveredSpeechMs: 9500,
  })),
};
it("uses genuine TV96/movie86 timing thresholds and retains a checksum-bound successful alignment", () => {
  const common = {
    schemaVersion: 1,
    weights: "bazarr-1.6.2",
    matcher: "media-evidence-v1",
    catalogStatus: "confirmed",
    referenceHash: "c".repeat(64),
  };
  const episode = {
    ...common,
    kind: "episode",
    maximum: 360,
    score: 335,
    matches: ["series", "year", "season", "episode", "source"],
  };
  const movie = {
    ...common,
    kind: "movie",
    maximum: 180,
    score: 160,
    matches: ["title", "year", "source", "edition"],
  };
  expect(
    needsSubtitleTimingV1(
      { matchScoreV1: episode },
      videoChecksum,
      subtitleChecksum,
    ),
  ).toBe(true);
  expect(
    needsSubtitleTimingV1(
      { matchScoreV1: movie },
      videoChecksum,
      subtitleChecksum,
    ),
  ).toBe(false);
  const aligned = {
    matchScoreV1: episode,
    timingAlignedV1: { schemaVersion: 1, videoChecksum, subtitleChecksum },
  };
  expect(needsSubtitleTimingV1(aligned, videoChecksum, subtitleChecksum)).toBe(
    false,
  );
  expect(needsSubtitleTimingV1(aligned, videoChecksum, "d".repeat(64))).toBe(
    true,
  );
  expect(() =>
    needsSubtitleTimingV1(
      { matchScoreV1: { ...episode, score: 360 } },
      videoChecksum,
      subtitleChecksum,
    ),
  ).toThrow();
});
it("accepts independently measured dialogue throughout the video without changing forced provenance", () => {
  expect(regularDialogueCovered(full, videoChecksum, subtitleChecksum)).toBe(
    true,
  );
  expect(regularDialogueCovered(full, "c".repeat(64), subtitleChecksum)).toBe(
    false,
  );
});
it("rejects sparse forced captions even when their first and last cues span the film", () => {
  const sparse = {
    ...full,
    coveredSpeechMs: 1200,
    windows: full.windows.map((w) => ({ ...w, coveredSpeechMs: 100 })),
  };
  expect(regularDialogueCovered(sparse, videoChecksum, subtitleChecksum)).toBe(
    false,
  );
});
it("rejects a missing dialogue region even if global coverage clears the floor", () => {
  const windows = full.windows.map((w, i) => ({
    ...w,
    coveredSpeechMs: i === 5 ? 5000 : 10_000,
  }));
  expect(
    regularDialogueCovered(
      { ...full, coveredSpeechMs: 115_000, windows },
      videoChecksum,
      subtitleChecksum,
    ),
  ).toBe(false);
});
