import assert from "node:assert/strict";
import test from "node:test";
import { prepareNativeTerrainChampionKeyframes } from "./native-terrain-champion-keyframes.mjs";

function fixture({ duplicate = false, verified = true } = {}) {
  const identity = { build: "16.23.840.6595", protocol: "8bbfcd5af2bc92db" };
  const keyframes = [
    { timeSeconds: 0, chunkOffset: 100 },
    { timeSeconds: 60, chunkOffset: 200 },
  ];
  return {
    packetReader: {
      ...identity,
      keyframes,
      read(timeSeconds) {
        const keyframe = keyframes.find(
          (frame) => frame.timeSeconds === timeSeconds,
        );
        const original = {
          explicitOpcode: 944,
          marker: 0,
          paramBits: 1073742161,
          stream: 2,
          chunkOffset: keyframe.chunkOffset,
          payload: Uint8Array.of(4, 5),
        };
        return {
          keyframe,
          packets: [
            original,
            {
              ...original,
              marker: 32,
              explicitOpcode: null,
              paramBits: 1,
              payload: Uint8Array.of(99),
            },
            ...(duplicate ? [original] : []),
          ],
        };
      },
    },
    observations: {
      ...identity,
      roster: [{ champion: "fixture" }, { champion: "unresolved" }],
      binding: {
        verified: verified ? [{ context: 1073742161, footerRow: 1 }] : [],
      },
      turrets: [{ context: 1073742162 }],
    },
  };
}

test("decodes only verified opening champion data and retains absent-time frames", () => {
  const calls = [];
  const { frames, coverage } = prepareNativeTerrainChampionKeyframes(
    fixture(),
    (body) => {
      calls.push([...body]);
      return { x: body[0], z: body[1] };
    },
  );
  assert.deepEqual(calls, [[4, 5]]);
  assert.deepEqual(frames, [
    { timeSeconds: 0, markers: [{ participantId: 1073742161, x: 4, z: 5 }] },
    { timeSeconds: 60, markers: [] },
  ]);
  assert.equal(coverage.admittedMarkers, 1);
  assert.equal(coverage.unknownLifecycle, 1);
});

test("rejects duplicate champion position packets before decoding", () => {
  assert.throws(
    () =>
      prepareNativeTerrainChampionKeyframes(
        fixture({ duplicate: true }),
        () => {
          assert.fail("The decoder ran on a malformed snapshot");
        },
      ),
    /Duplicate champion 944/,
  );
});

test("retains keyframe count without guessing unverified participants", () => {
  const { frames, coverage } = prepareNativeTerrainChampionKeyframes(
    fixture({ verified: false }),
    () => assert.fail("The decoder ran on unverified data"),
  );
  assert.equal(coverage.verifiedParticipants, 0);
  assert.equal(coverage.keyframes, 2);
  assert.equal(coverage.populatedKeyframes, 0);
  assert.ok(frames.every(({ markers }) => markers.length === 0));
});
