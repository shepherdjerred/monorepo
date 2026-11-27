import assert from "node:assert/strict";
import test from "node:test";
import {
  position944SubstitutionIndex,
  rotateByteLeft,
  swapAdjacentBits,
} from "./native-terrain-byte-codecs.mjs";
import {
  createCurrentRecordedTeamVisionCollector,
  readCurrentRecordedTeamVision,
} from "./recorded-team-vision.mjs";

const replay = {
  build: "16.23.841.8428",
  protocol: "8bbfcd5af2bc92db",
  durationMilliseconds: 20_000,
};
const codecs = {
  decodePositionByte: (value) =>
    (position944SubstitutionIndex(value) + 0x67) & 0xff,
};
const scene = {
  participants: [{ participantId: 1200, teamId: 100 }],
  worldUnitModels: { instances: [{ context: 1201, creationTimeSeconds: 4 }] },
};
const packet = (explicitOpcode, timeSeconds, paramBits, slot, stream = 1) => ({
  explicitOpcode,
  timeSeconds,
  paramBits,
  stream,
  marker: 0,
  chunkOffset: stream === 1 ? 20 : timeSeconds === 0 ? 10 : 30,
  blockOffset: 0,
  payload:
    slot === undefined
      ? new Uint8Array(0)
      : Uint8Array.of(
          1,
          rotateByteLeft(swapAdjacentBits(slot) ^ 0x71 ^ 0xff, 3),
        ),
});
const read = (packets) =>
  readCurrentRecordedTeamVision(replay, scene, packets, codecs);

test("folds opening and gameplay masks in physical order, including late actors", () => {
  assert.deepEqual(
    read([
      packet(1012, 0, 1200, undefined, 2),
      packet(66, 0, 1200, 1),
      packet(66, 3, 1201, 2),
      packet(1012, 4, 1201),
      { ...packet(66, 4, 1201, 2), explicitOpcode: 66, blockOffset: 1 },
      {
        ...packet(66, 4, 1, 2),
        explicitOpcode: null,
        blockOffset: 2,
        marker: 32,
      },
      packet(66, 8, 1200, 2),
      packet(696, 8, 1200, 2),
      packet(696, 10, 1201, 2),
      packet(66, 12, 1201, 2, 2),
    ]),
    [
      { context: 1200, changes: [[0, 2]] },
      {
        context: 1201,
        changes: [
          [4, 4],
          [10, 0],
        ],
      },
    ],
  );
});

test("fails closed for missing initialization, wrong champion side, and bad framing", () => {
  const initialization = [
    packet(66, 0, 1200, 1),
    packet(1012, 0, 1200),
    packet(1012, 4, 1201),
  ];
  assert.throws(
    () => read(initialization.slice(0, 2)),
    /missing a rendered actor/,
  );
  assert.throws(
    () => read([...initialization, packet(696, 5, 1200, 1)]),
    /roster team/,
  );
  assert.throws(
    () => read([...initialization, packet(66, 5, 1201)]),
    /mask framing/,
  );
  assert.throws(
    () => read([...initialization, packet(66, 5, 1201, 3)]),
    /spectator team/,
  );
  assert.throws(
    () =>
      readCurrentRecordedTeamVision(
        { ...replay, build: "16.23.840.6595" },
        scene,
        initialization,
        codecs,
      ),
    /exact .8428/,
  );
});

test("includes admitted late actors and respects pre-birth clock and physical order", () => {
  const { observe, addCandidate, finish } =
    createCurrentRecordedTeamVisionCollector(
      replay,
      scene.participants,
      [],
      codecs,
      { dynamicActors: true },
    );
  observe(packet(1012, 0, 1200));
  observe(packet(66, 0, 1200, 1));
  observe(packet(66, 3, 1201, 1));
  observe(packet(1012, 4, 1201));
  observe(packet(66, 4, 1201, 2));
  addCandidate(1201, 4);
  addCandidate(1202, 4);
  observe(packet(696, 4, 1201, 2));
  observe(packet(66, 4, 1201, 1));
  assert.deepEqual(finish(new Set([1201])), [
    { context: 1200, changes: [[0, 2]] },
    { context: 1201, changes: [[4, 2]] },
  ]);
  assert.throws(
    () => finish(new Set([1201, 1202])),
    /missing a rendered actor/,
  );
});
