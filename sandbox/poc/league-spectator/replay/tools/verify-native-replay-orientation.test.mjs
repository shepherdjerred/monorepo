import { expect, test } from "bun:test";
import {
  requireDisjointCapturePlans,
  verifyNativeOrientation,
} from "./verify-native-replay-orientation.mjs";

const digest = "a".repeat(64);
const identity = {
  replaySha256: digest,
  build: "16.23.840.6595",
  protocol: "8bbfcd5af2bc92db",
  participantCount: 1,
  durationMilliseconds: 10_000,
};

function receipt(requestedTimes, observedTimes = requestedTimes) {
  return {
    ...identity,
    schemaVersion: 1,
    purpose: "local-verification-only",
    requestedTimes,
    reference: {
      source: "riot-replay-api-camera-attachment",
      processID: 1,
      replayIdentity: "operator-confirmed",
      replayDigestAttestedByApi: false,
      participantKey: "one-based-rofl-footer-row",
      captureMethod: "continuous",
    },
    samples: requestedTimes.map((requestedTime, index) => ({
      key: 1,
      requestedTime,
      time: observedTimes[index],
      position: [1, 2, 3],
    })),
  };
}

test("requires exact replay identity and disjoint requested and observed clocks", () => {
  const calibration = receipt([1, 3], [1.1, 3.1]);
  const heldOut = receipt([2, 4]);
  expect(
    requireDisjointCapturePlans(identity, calibration, heldOut).map(
      (plan) => plan.length,
    ),
  ).toEqual([2, 2]);
  expect(() =>
    requireDisjointCapturePlans(identity, calibration, {
      ...heldOut,
      replaySha256: "0".repeat(64),
    }),
  ).toThrow("Reference replay identity mismatch");
  expect(() =>
    requireDisjointCapturePlans(
      identity,
      calibration,
      receipt([1.05, 3.05], [1.1, 3.1]),
    ),
  ).toThrow("distinct clock observations");
  expect(() =>
    requireDisjointCapturePlans(
      identity,
      calibration,
      receipt([1, 4], [1.02, 4]),
    ),
  ).toThrow("distinct clock observations");
});

test("keeps unknown authored teams distinct and scores only the calibration orientation", () => {
  const placement = {
    archivedBuild: "16.21.829.8620",
    archivedSha256: digest,
    installedSha256: digest,
    installedCompatibilityVersion: "16.23.8406595+branch.release",
    entryPath: "data/maps/mapgeometry/map11/base_srx.materials.bin",
    attackableType: 0,
    uniqueMatches: 24,
    records: Array.from({ length: 24 }, (_, keyHash) => ({
      keyHash,
      installedOffset: keyHash * 128,
      explicitTeam: keyHash < 12 ? null : 200,
      sha256: digest,
      translation: [keyHash, 0, keyHash < 12 ? 0 : 100],
    })),
  };
  const roster = Array.from({ length: 10 }, (_, index) => ({
    team: index < 5 ? 100 : 200,
  }));
  const replay = { build: identity.build, roster };
  const start = roster.map(({ team }, index) => ({
    key: index + 1,
    position: [team === 100 ? 5 : 120, 0, 0],
  }));
  const heldOut = start.map((sample) => ({ ...sample, position: [50, 0, 0] }));
  const result = verifyNativeOrientation(replay, start, heldOut, placement);
  expect(Object.keys(result.authored)).toEqual(["unknown", "explicitTeam200"]);
  expect(result.calibration.map(({ low, high }) => [low, high])).toEqual([
    [5, 0],
    [0, 5],
  ]);
  expect(result.heldOut.map(({ between }) => between)).toEqual([5, 5]);
  expect(() =>
    verifyNativeOrientation(
      replay,
      start.map((sample) => ({
        ...sample,
        position: [sample.position[0] === 5 ? 120 : 5, 0, 0],
      })),
      heldOut,
      placement,
    ),
  ).toThrow("calibration team orientations disagree");
  expect(() =>
    verifyNativeOrientation(replay, start, heldOut, {
      ...placement,
      installedCompatibilityVersion: "16.23.8399929+branch.release",
    }),
  ).toThrow("Installed placement build differs from the replay build");
});
