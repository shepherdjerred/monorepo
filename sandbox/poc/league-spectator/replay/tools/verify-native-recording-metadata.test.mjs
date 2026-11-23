import { expect, test } from "bun:test";
import {
  summarizePacketTiming,
  validateComparisonReceipts,
  validateRecordingReceipt,
  verifyRecordingCoverage,
} from "./verify-native-recording-metadata.mjs";

const replay = {
  build: "16.23.840.6595",
  protocol: "test",
  durationMilliseconds: 1757163,
  replaySha256: "a".repeat(64),
};
const receipt = {
  ...replay,
  schemaVersion: 1,
  purpose: "local-verification-only",
  mediaSha256: "b".repeat(64),
  reference: {
    source: "riot-replay-api-recording",
    replayIdentity: "operator-confirmed",
    replayDigestAttestedByApi: false,
    operatorReviewed: true,
    playbackRate: 1,
  },
  window: { startSeconds: 2, endSeconds: 7 },
  mediaClockAnchor: { replaySeconds: 3, mediaPtsSeconds: 1.125 },
};
const browserReceipt = {
  ...receipt,
  mediaSha256: "d".repeat(64),
  reference: { ...receipt.reference, source: "browser-replay-recording" },
  mediaClockAnchor: { replaySeconds: 4, mediaPtsSeconds: 13 },
};

test("maps the same reviewed replay window through independent native and browser anchors", () => {
  expect(validateComparisonReceipts(replay, receipt, browserReceipt)).toEqual({
    replayWindow: { startSeconds: 2, endSeconds: 7 },
    nativeWindow: { startPtsSeconds: 0.125, endPtsSeconds: 5.125 },
    browserWindow: { startPtsSeconds: 11, endPtsSeconds: 16 },
  });
});

test("requires separate reviewed 1x media for the exact replay identity and window", () => {
  expect(() =>
    validateComparisonReceipts(replay, browserReceipt, receipt),
  ).toThrow("reviewed native recording evidence");
  expect(() =>
    validateComparisonReceipts(replay, receipt, {
      ...browserReceipt,
      reference: receipt.reference,
    }),
  ).toThrow("reviewed browser recording evidence");
  expect(() =>
    validateComparisonReceipts(replay, receipt, {
      ...browserReceipt,
      reference: { ...browserReceipt.reference, playbackRate: 2 },
    }),
  ).toThrow("reviewed browser recording evidence");
  expect(() =>
    validateComparisonReceipts(replay, receipt, {
      ...browserReceipt,
      mediaSha256: receipt.mediaSha256,
    }),
  ).toThrow("independently recorded");
  for (const [key, value] of Object.entries({
    build: "another-build",
    protocol: "another-protocol",
    durationMilliseconds: 100_000,
    replaySha256: "c".repeat(64),
  })) {
    expect(() =>
      validateComparisonReceipts(replay, receipt, {
        ...browserReceipt,
        [key]: value,
      }),
    ).toThrow("Browser recording receipt replay identity mismatch");
  }
  expect(() =>
    validateComparisonReceipts(replay, receipt, {
      ...browserReceipt,
      window: { ...receipt.window, endSeconds: 6 },
    }),
  ).toThrow("Reviewed replay windows differ");
});

test("requires audio over the independently mapped browser window", () => {
  const { browserWindow } = validateComparisonReceipts(
    replay,
    receipt,
    browserReceipt,
  );
  const video = {
    kind: "video",
    packets: 5,
    packetsWithoutPts: 0,
    ...browserWindow,
  };
  expect(() =>
    verifyRecordingCoverage([video], browserWindow, "browser"),
  ).toThrow("Expected one audio track in the browser recording");
});

test("maps a replay window through the independently reviewed media anchor", () => {
  expect(validateRecordingReceipt(replay, receipt)).toEqual({
    startPtsSeconds: 0.125,
    endPtsSeconds: 5.125,
  });
});

test("rejects wrong replay identity, missing recording review and intervals beyond the replay footer", () => {
  expect(() =>
    validateRecordingReceipt(replay, {
      ...receipt,
      replaySha256: "c".repeat(64),
    }),
  ).toThrow("identity mismatch");
  expect(() =>
    validateRecordingReceipt(replay, { ...receipt, reference: undefined }),
  ).toThrow("reviewed native recording evidence");
  expect(() =>
    validateRecordingReceipt(replay, {
      ...receipt,
      window: { ...receipt.window, endSeconds: 1763.1639404296875 },
    }),
  ).toThrow("Invalid native recording window");
});

test("requires both tracks to enclose the exact reviewed window with packet PTS", () => {
  const window = validateRecordingReceipt(replay, receipt);
  const audio = { kind: "audio", packets: 5, packetsWithoutPts: 0, ...window };
  const video = { ...audio, kind: "video" };
  expect(() => verifyRecordingCoverage([audio, video], window)).not.toThrow();
  expect(() => verifyRecordingCoverage([video], window)).toThrow(
    "Expected one audio track",
  );
  expect(() =>
    verifyRecordingCoverage(
      [audio, { ...video, packetsWithoutPts: 1 }],
      window,
    ),
  ).toThrow("video packet timestamps");
  expect(() =>
    verifyRecordingCoverage(
      [audio, { ...video, startPtsSeconds: 0.126 }],
      window,
    ),
  ).toThrow("video packet timestamps");
});

test("reports an interior gap even when the packet extents enclose the window", () => {
  expect(
    summarizePacketTiming(
      [
        [4, 4.5],
        [2.5, 3.75],
        [0, 1.25],
        [1, 1.5],
      ],
      { startPtsSeconds: 1, endPtsSeconds: 4 },
    ),
  ).toEqual({
    largestPacketStartStepSeconds: 1.5,
    largestGapBetweenDeclaredPacketsSeconds: 1,
    packetsWithUnknownDuration: 0,
  });
});

test("accepts representation roundoff at the media boundary and rejects a millisecond gap", () => {
  const window = validateRecordingReceipt(replay, {
    ...receipt,
    window: { startSeconds: 0.1, endSeconds: 0.4 },
    mediaClockAnchor: { replaySeconds: 0.2, mediaPtsSeconds: 0.3 },
  });
  const audio = {
    kind: "audio",
    packets: 5,
    packetsWithoutPts: 0,
    startPtsSeconds: 0.2,
    endPtsSeconds: 0.5,
  };
  const video = { ...audio, kind: "video" };
  expect(() => verifyRecordingCoverage([audio, video], window)).not.toThrow();
  expect(() =>
    verifyRecordingCoverage(
      [audio, { ...video, startPtsSeconds: 0.201 }],
      window,
    ),
  ).toThrow("video packet timestamps");
});

test("keeps missing packet durations separate from start-time continuity", () => {
  expect(
    summarizePacketTiming(
      [
        [0, 0],
        [0.5, 1],
      ],
      {
        startPtsSeconds: 0,
        endPtsSeconds: 1,
      },
    ),
  ).toEqual({
    largestPacketStartStepSeconds: 0.5,
    largestGapBetweenDeclaredPacketsSeconds: null,
    packetsWithUnknownDuration: 1,
  });
});
