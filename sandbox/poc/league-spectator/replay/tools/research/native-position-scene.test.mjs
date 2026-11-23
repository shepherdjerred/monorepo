import { expect, test } from "bun:test";
import { createNativePositionSceneTrace } from "./native-position-scene.mjs";

function inputs() {
  const identity = {
    replaySha256: "a".repeat(64),
    build: "16.23.840.6595",
    protocol: "8bbfcd5af2bc92db",
    durationMilliseconds: 10000,
    participantCount: 2,
  };
  const observations = {
    build: identity.build,
    protocol: identity.protocol,
    duration: 10,
    roster: [
      { champion: "One", team: 100, rawPlayerName: "PRIVATE" },
      { champion: "Two", team: 200 },
    ],
    binding: {
      verified: [
        { context: 10, footerRow: 2 },
        { context: 20, footerRow: 1 },
      ],
      unresolved: [],
    },
  };
  const receipt = {
    schemaVersion: 1,
    ...identity,
    purpose: "local-verification-only",
    reference: {
      source: "riot-replay-api-camera-attachment",
      replayIdentity: "operator-confirmed",
      replayDigestAttestedByApi: false,
      participantKey: "one-based-rofl-footer-row",
      processID: 999,
    },
    requestedTimes: [1, 3],
    samples: [1, 3].flatMap((time) =>
      [1, 2].map((key) => ({
        key,
        requestedTime: time,
        time,
        position: [key * 10, 777, time * 20],
      })),
    ),
  };
  return { identity, observations, receipt };
}

test("preserves original projected points and exact clocks, binds by verified row, strips private identities", () => {
  const { identity, observations, receipt } = inputs();
  const result = createNativePositionSceneTrace(identity, observations, [
    receipt,
  ]);
  expect(result.trace.frames.map((frame) => frame.timeSeconds)).toEqual([
    0, 1, 3, 10,
  ]);
  expect(result.trace.frames[0].actors).toEqual([]);
  expect(result.trace.frames.at(-1).actors).toEqual([]);
  expect(result.trace.frames[1].actors).toEqual([
    { participantId: 10, x: 20, y: 20, visibleTo: [] },
    { participantId: 20, x: 10, y: 20, visibleTo: [] },
  ]);
  expect(result.trace.participants[0]).toEqual({
    participantId: 20,
    name: "One",
    championName: "One",
    teamId: 100,
  });
  expect(result.trace.width).toBe(20);
  expect(result.trace.height).toBe(60);
  expect(result.projection.sampling).toBe("exact");
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(JSON.stringify(result)).not.toContain("processID");
  expect(JSON.stringify(result)).not.toContain("777");
  expect(
    result.trace.frames.every((frame) => frame.directedParticipantId === null),
  ).toBe(true);
});

test("foreign receipts and observation clocks reject before emitting trace", () => {
  const { identity, observations, receipt } = inputs();
  expect(() =>
    createNativePositionSceneTrace(identity, observations, [
      { ...receipt, replaySha256: "b".repeat(64) },
    ]),
  ).toThrow("identity mismatch");
  expect(() =>
    createNativePositionSceneTrace(
      identity,
      { ...observations, duration: 11 },
      [receipt],
    ),
  ).toThrow("identity");
});

test("duplicate capture clocks across receipts or within distinct requested groups reject", () => {
  const { identity, observations, receipt } = inputs();
  expect(() =>
    createNativePositionSceneTrace(identity, observations, [receipt, receipt]),
  ).toThrow("Duplicate native capture clock");
  receipt.requestedTimes = [1, 1.1];
  receipt.samples = receipt.samples.map((sample) => ({
    ...sample,
    requestedTime: sample.requestedTime === 3 ? 1.1 : 1,
    time: 1.2,
  }));
  expect(() =>
    createNativePositionSceneTrace(identity, observations, [receipt]),
  ).toThrow("Duplicate native capture clock");
});

test("unresolved or duplicate footer bindings never silently select another actor", () => {
  const { identity, observations, receipt } = inputs();
  observations.binding.unresolved = [10];
  expect(() =>
    createNativePositionSceneTrace(identity, observations, [receipt]),
  ).toThrow("unambiguous");
  observations.binding.unresolved = [];
  observations.binding.verified[1].footerRow = 2;
  expect(() =>
    createNativePositionSceneTrace(identity, observations, [receipt]),
  ).toThrow("ambiguous");
});

test("incomplete samples, nonfinite points and unrepresentable negative projections reject", () => {
  const { identity, observations, receipt } = inputs();
  const missing = structuredClone(receipt);
  missing.samples.pop();
  expect(() =>
    createNativePositionSceneTrace(identity, observations, [missing]),
  ).toThrow("coverage");
  receipt.samples[0].position[0] = NaN;
  expect(() =>
    createNativePositionSceneTrace(identity, observations, [receipt]),
  ).toThrow("actor");
  receipt.samples[0].position[0] = -1;
  expect(() =>
    createNativePositionSceneTrace(identity, observations, [receipt]),
  ).toThrow("negative");
});

test("genuinely captured endpoints are retained instead of replaced by missing-data sentinels", () => {
  const { identity, observations, receipt } = inputs();
  receipt.requestedTimes = [0, 10];
  receipt.samples = receipt.samples.map((sample) => ({
    ...sample,
    requestedTime: sample.requestedTime === 1 ? 0 : 10,
    time: sample.time === 1 ? 0 : 10,
  }));
  const result = createNativePositionSceneTrace(identity, observations, [
    receipt,
  ]);
  expect(result.trace.frames.map((frame) => frame.timeSeconds)).toEqual([
    0, 10,
  ]);
  expect(result.trace.frames.every((frame) => frame.actors.length === 2)).toBe(
    true,
  );
});
