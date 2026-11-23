import { expect, test } from "bun:test";
import { probePositionScalars } from "./probe-position-scalars.mjs";

const identity = {
  replaySha256: "a".repeat(64),
  build: "16.23.840.6595",
  protocol: "8bbfcd5af2bc92db",
  durationMilliseconds: 10000,
  participantCount: 2,
};
const requestedTimes = [1, 3, 5, 7, 9];
const reference = {
  schemaVersion: 1,
  ...identity,
  purpose: "local-verification-only",
  reference: {
    source: "riot-replay-api-camera-attachment",
    replayIdentity: "operator-confirmed",
    replayDigestAttestedByApi: false,
    participantKey: "one-based-rofl-footer-row",
  },
  requestedTimes,
  samples: requestedTimes.flatMap((time) => [
    {
      key: 1,
      time,
      requestedTime: time,
      position: [100 + 60 * time, 0, 200 + 80 * time],
    },
    { key: 2, time, requestedTime: time, position: [1000, 0, 1100] },
  ]),
};

function records() {
  return requestedTimes.map((time) => {
    const payload = new Uint8Array(4);
    const view = new DataView(payload.buffer);
    view.setInt16(0, 30 * time, true);
    view.setInt16(2, 40 * time, true);
    return {
      stream: 1,
      blockOffset: 0,
      explicitOpcode: 42,
      marker: 1,
      paramBits: 100,
      payload,
      timeSeconds: time,
    };
  });
}

test("a planted scalar field predicts independent observations without passing the actor shift", () => {
  const result = probePositionScalars(identity, [reference], records());
  expect(result.anchors.map(({ split }) => split)).toEqual([
    "calibration",
    "calibration",
    "held-out",
    "held-out",
    "held-out",
  ]);
  for (const model of Object.values(result.hypotheses)) {
    expect(model).toMatchObject({
      recurringTracks: 1,
      tracksWithCoverage: 1,
      matched: 1,
      shiftedMatched: 0,
    });
    expect(model.candidates[0]).toMatchObject({
      key: "42/4/100",
      actor: 1,
      format: "i16-le",
      offset: 0,
      stride: 2,
      heldOutCount: 3,
      maximumPlanarError: 0,
    });
  }
});

test("a held-out discrepancy disqualifies the calibration fit", () => {
  const changed = records();
  changed[3].payload.fill(0);
  const { hypotheses } = probePositionScalars(identity, [reference], changed);
  expect(hypotheses.signed.tested).toBeGreaterThan(0);
  expect(hypotheses.signed.matched).toBe(0);
  expect(hypotheses.unsigned.matched).toBe(0);
});

test("rejects mismatched and repeated reference observations", () => {
  expect(() =>
    probePositionScalars(
      identity,
      [{ ...reference, replaySha256: "b".repeat(64) }],
      [],
    ),
  ).toThrow("Reference replay identity mismatch");
  expect(() =>
    probePositionScalars(identity, [reference, reference], []),
  ).toThrow("Overlapping reference time groups");
});
