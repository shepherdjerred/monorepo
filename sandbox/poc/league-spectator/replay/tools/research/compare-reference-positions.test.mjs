import { expect, test } from "bun:test";
import {
  compareReferencePositions,
  planPositionComparison,
} from "./compare-reference-positions.mjs";

const replay = {
  replaySha256: "a".repeat(64),
  build: "16.23.840.6595",
  protocol: "8bbfcd5af2bc92db",
  durationMilliseconds: 10_000,
};
const identity = { ...replay, participantCount: 2 };
const participantKey = "one-based-rofl-footer-row";
const reference = {
  schemaVersion: 1,
  ...replay,
  purpose: "local-verification-only",
  reference: {
    source: "riot-replay-api-camera-attachment",
    replayIdentity: "operator-confirmed",
    replayDigestAttestedByApi: false,
    participantKey,
  },
  requestedTimes: [1, 3, 5],
  samples: [1, 3, 5].flatMap((requestedTime) =>
    [1, 2].map((key) => ({
      key,
      requestedTime,
      time: requestedTime,
      position: [key * 10, 7, requestedTime * 10],
    })),
  ),
};
const decoded = {
  schemaVersion: 1,
  ...replay,
  captureMethod: "continuous",
  participantKey,
  frames: [
    {
      requestedTime: 1,
      time: 1,
      actors: [
        { key: 1, position: [10, 7, 10] },
        { key: 2, position: [20, 7, 10] },
      ],
    },
    {
      requestedTime: 5,
      time: 5.25,
      actors: [{ key: 1, position: [13, 13, 54] }],
    },
  ],
};

const cueTimes = { start: 1, turn: 1.125, arrival: 1.25 };
const follow = {
  ...reference,
  reference: {
    ...reference.reference,
    captureMethod: "continuous-follow",
    cueTimes,
  },
  requestedTimes: Object.values(cueTimes),
  samples: [
    [0.96875, 1],
    [1.09375, 1.15625],
    [1.1875, 1.21875],
    [1.25, 1.265625],
    [1.28125, 1.296875],
    [1.3125, 1.34375],
  ].map(([timeBefore, timeAfter]) => ({
    timeBefore,
    timeAfter,
    key: 2,
    position: [20, 20, 20],
  })),
};

test("keeps continuous follow brackets exact and separate at the turn cue", () => {
  const plan = planPositionComparison(identity, follow);
  expect(plan.followedActorKey).toBe(2);
  expect(plan.cueTimes).toEqual(cueTimes);
  expect(plan.sampleBrackets.slice(0, 3)).toEqual([
    { index: 0, timeBefore: 0.96875, timeAfter: 1, split: "calibration" },
    { index: 1, timeBefore: 1.09375, timeAfter: 1.15625, split: "straddling" },
    { index: 2, timeBefore: 1.1875, timeAfter: 1.21875, split: "held-out" },
  ]);
  expect(JSON.stringify(plan)).not.toContain("position");
});

test("scores positions only when the decoder's timestamp fits the bracket", () => {
  const actors = [{ key: 2, position: [23, 24, 24] }];
  const candidate = {
    ...decoded,
    captureMethod: "continuous-follow",
    frames: [
      { index: 0, time: 1, actors },
      { index: 2, time: 1.15625, actors },
      { index: 3, time: 1.28125, actors },
      { index: 4, time: null, actors },
      { index: 5, time: 1.3125, actors: [] },
    ],
  };
  const report = compareReferencePositions(identity, follow, candidate);
  expect(report.frames.map(({ timeStatus }) => timeStatus)).toEqual([
    "matched",
    "missing",
    "before",
    "after",
    "missing",
    "matched",
  ]);
  expect(report.frames[0].actor).toEqual({
    key: 2,
    planarError: 5,
    verticalError: 4,
  });
  expect(report.frames[2].bracketErrorSeconds).toBe(0.03125);
  expect(report.frames[3].bracketErrorSeconds).toBe(0.015625);
  expect(report.frames.slice(1).every(({ actor }) => actor === null)).toBe(
    true,
  );
  expect(report.splits.heldOut).toEqual({
    expectedFrames: 4,
    missingFrames: 0,
    missingTimeFrames: 1,
    outsideBracketFrames: 2,
    missingActors: 1,
    scoredActors: 0,
    planarError: { max: null, mean: null },
    verticalError: { max: null, mean: null },
  });
  expect(report.splits.straddling.missingFrames).toBe(1);
  expect(() =>
    compareReferencePositions(identity, follow, {
      ...candidate,
      frames: [
        { index: 0, time: 1, actors: [{ key: 1, position: [0, 0, 0] }] },
      ],
    }),
  ).toThrow("decoder frame");
});

test("rejects follow receipts with invalid coverage, gap, actor or identity", () => {
  const change = (run) => {
    const input = structuredClone(follow);
    run(input);
    return () => planPositionComparison(identity, input);
  };
  expect(
    change((input) => {
      input.samples = input.samples.slice(0, 3);
    }),
  ).toThrow("cue window");
  expect(
    change((input) => {
      input.samples.splice(1, 1);
    }),
  ).toThrow("bracket, or gap");
  expect(
    change((input) => {
      input.samples[1].key = 1;
    }),
  ).toThrow("clock bracket");
  expect(
    change((input) => {
      input.replaySha256 = "b".repeat(64);
    }),
  ).toThrow("identity mismatch");
});

test("builds a deterministic position-free plan, using the legacy continuous method", () => {
  const plan = planPositionComparison(identity, reference);
  expect(plan).toEqual({
    schemaVersion: 1,
    ...identity,
    captureMethod: "continuous",
    participantKey,
    sampleTimes: [
      { requestedTime: 1, time: 1, split: "calibration" },
      { requestedTime: 3, time: 3, split: "calibration" },
      { requestedTime: 5, time: 5, split: "held-out" },
    ],
  });
});

test("keeps held-out discrepancies and missing coverage visible", () => {
  const report = compareReferencePositions(identity, reference, decoded);
  expect(report.frames[1]).toEqual({
    requestedTime: 3,
    nativeTime: 3,
    decoderTime: null,
    timeErrorSeconds: null,
    split: "calibration",
    missingKeys: [1, 2],
    actors: [],
  });
  expect(report.frames[2]).toEqual({
    requestedTime: 5,
    nativeTime: 5,
    decoderTime: 5.25,
    timeErrorSeconds: 0.25,
    split: "held-out",
    missingKeys: [2],
    actors: [{ key: 1, planarError: 5, verticalError: 6 }],
  });
  expect(report.splits.calibration).toEqual({
    expectedFrames: 2,
    missingFrames: 1,
    matchedFrames: 1,
    expectedActors: 4,
    missingActors: 2,
    matchedActors: 2,
    planarError: { max: 0, mean: 0 },
    timeErrorSeconds: { max: 0, mean: 0 },
  });
  expect(report.splits.heldOut).toEqual({
    expectedFrames: 1,
    missingFrames: 0,
    matchedFrames: 1,
    expectedActors: 2,
    missingActors: 1,
    matchedActors: 1,
    planarError: { max: 5, mean: 5 },
    timeErrorSeconds: { max: 0.25, mean: 0.25 },
  });
  const empty = compareReferencePositions(identity, reference, {
    ...decoded,
    frames: [],
  });
  expect(empty.splits.heldOut.planarError).toEqual({ max: null, mean: null });
  expect(empty.splits.heldOut.timeErrorSeconds).toEqual({
    max: null,
    mean: null,
  });
});

test("rejects mismatched identity, capture scope or invalid reference coverage", () => {
  expect(() =>
    planPositionComparison(identity, {
      ...reference,
      protocol: "b".repeat(16),
    }),
  ).toThrow("Reference replay identity mismatch");
  expect(() =>
    compareReferencePositions(identity, reference, {
      ...decoded,
      replaySha256: "b".repeat(64),
    }),
  ).toThrow("Decoder replay identity mismatch");
  expect(() =>
    compareReferencePositions(identity, reference, {
      ...decoded,
      captureMethod: "paused-seek",
    }),
  ).toThrow("Invalid decoder capture scope");
  expect(() =>
    compareReferencePositions(identity, reference, {
      ...decoded,
      participantKey: "net-id",
    }),
  ).toThrow("Invalid decoder capture scope");
  expect(() =>
    planPositionComparison(identity, {
      ...reference,
      requestedTimes: [1, 1, 5],
    }),
  ).toThrow("strictly increasing");
  expect(() =>
    planPositionComparison(identity, {
      ...reference,
      samples: reference.samples.slice(0, -1),
    }),
  ).toThrow("Incomplete reference actor coverage");
  expect(() =>
    planPositionComparison(identity, {
      ...reference,
      samples: [reference.samples[0], ...reference.samples],
    }),
  ).toThrow("Invalid or duplicate reference actor");
});

test("distinguishes paused seek and continuous clock validation", () => {
  const timed = (captureMethod, elapsed) => ({
    ...reference,
    reference: { ...reference.reference, captureMethod },
    samples: reference.samples.map((sample) => ({
      ...sample,
      time: sample.time + elapsed,
    })),
  });
  expect(
    planPositionComparison(identity, timed("paused-seek", -0.001))
      .captureMethod,
  ).toBe("paused-seek");
  expect(() =>
    planPositionComparison(identity, timed("paused-seek", 0.003)),
  ).toThrow("Invalid reference sample clock");
  expect(() =>
    planPositionComparison(identity, timed("continuous", -0.001)),
  ).toThrow("Invalid reference sample clock");
  expect(() =>
    planPositionComparison(identity, timed("continuous", 0.501)),
  ).toThrow("Invalid reference sample clock");
  const inconsistent = structuredClone(reference);
  inconsistent.samples[0].time += 0.001;
  expect(() => planPositionComparison(identity, inconsistent)).toThrow(
    "Invalid reference sample clock",
  );
});

test("rejects invalid, unknown or duplicate decoder frames and actors", () => {
  const frame = decoded.frames[0];
  const run = (...frames) =>
    compareReferencePositions(identity, reference, { ...decoded, frames });
  for (const invalid of [
    { ...frame, requestedTime: 2 },
    { ...frame, time: NaN },
    { ...frame, time: 11 },
  ])
    expect(() => run(invalid)).toThrow("Invalid or duplicate decoder frame");
  expect(() => run(frame, frame)).toThrow("Invalid or duplicate decoder frame");
  for (const actors of [
    [{ key: 3, position: [0, 0, 0] }],
    [{ key: 1, position: [0, Infinity, 0] }],
    [frame.actors[0], frame.actors[0]],
  ])
    expect(() => run({ ...frame, actors })).toThrow(
      "Invalid or duplicate decoder actor",
    );
});
