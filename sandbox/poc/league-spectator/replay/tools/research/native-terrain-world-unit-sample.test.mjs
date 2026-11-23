import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleNativeTerrainWorldUnits } from "./native-terrain-world-unit-sample.mjs";

const actors = [
  {
    participantId: 200,
    creationTimeSeconds: 10,
    killTimeSeconds: 20,
    paths: [
      {
        timeSeconds: 11,
        endTimeSeconds: 11,
        points: [[0, 4]],
        speeds: [{ timeSeconds: 11, speed: 0, distance: 0 }],
      },
      {
        timeSeconds: 13,
        endTimeSeconds: 15,
        points: [
          [0, 4],
          [10, 4],
        ],
        speeds: [{ timeSeconds: 13, speed: 5, distance: 0 }],
      },
      {
        timeSeconds: 19,
        endTimeSeconds: 20,
        points: [
          [10, 4],
          [15, 4],
        ],
        speeds: [{ timeSeconds: 19, speed: 5, distance: 0 }],
      },
    ],
  },
];
const at = (timeSeconds) =>
  sampleNativeTerrainWorldUnits(actors, timeSeconds, (x) => x / 2);

test("world units render only at recorded anchors or inside bounded paths before defeat", () => {
  assert.deepEqual(at(10.99), []);
  assert.deepEqual(at(11), [{ participantId: 200, position: [0, 0, 4] }]);
  assert.deepEqual(at(11.001), []);
  assert.deepEqual(at(14), [{ participantId: 200, position: [5, 2.5, 4] }]);
  assert.deepEqual(at(15), [{ participantId: 200, position: [10, 5, 4] }]);
  assert.deepEqual(at(15.001), []);
  assert.deepEqual(at(20), []);
  assert.deepEqual(at(13.5), [
    { participantId: 200, position: [2.5, 1.25, 4] },
  ]);
});
