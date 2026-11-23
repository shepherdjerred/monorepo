import assert from "node:assert/strict";
import test from "node:test";
import { prepareNativeTerrainInhibitors } from "./native-terrain-inhibitors.mjs";

function preparedFixture(lateValue = 0x81, verified = true) {
  const keyframes = [
    { timeSeconds: 0, chunkOffset: 100 },
    { timeSeconds: 10, chunkOffset: 200 },
  ];
  const loss = {
    kind: "inhibitor-destruction",
    context: 1073742125,
    timeSeconds: 8,
    secondTimeBits: 0,
  };
  const matchEnd = { kind: "match-ending-structure-loss", context: 1073742155 };
  return {
    packetReader: {
      build: "16.23.840.6595",
      protocol: "8bbfcd5af2bc92db",
      durationSeconds: 15,
      keyframes,
      read(timeSeconds) {
        const keyframe = timeSeconds >= 10 ? keyframes[1] : keyframes[0];
        const packets = Array.from({ length: 6 }, (_, index) => ({
          stream: 2,
          chunkOffset: keyframe.chunkOffset,
          explicitOpcode: index === 0 ? 947 : null,
          marker: index === 0 ? 0 : 32,
          paramBits: index === 0 ? 1073742125 : 1,
          payload: Uint8Array.of(index === 0 && timeSeconds >= 10 ? lateValue : 0x91),
        }));
        return { keyframe, packets };
      },
    },
    observations: { structures: verified ? [loss, matchEnd] : null },
  };
}

test("uses the exact corroborated event time and samples an earlier snapshot", () => {
  const overlay = prepareNativeTerrainInhibitors(preparedFixture());
  assert.equal(overlay.losses.length, 1);
  const first = (time) => overlay.read(time).inhibitors[0];
  assert.equal(first(7.99).seekState, "alive");
  assert.equal(first(8).seekState, "destroyed");
  assert.equal(first(8).keyframeState, "alive");
  assert.equal(first(10).keyframeState, "destroyed");
  assert.equal(first(0).seekState, "alive");
  assert.equal(overlay.read(15).inhibitors.length, 6);
});

test("admits only relationships corroborated by indexed states", () => {
  assert.throws(
    () => prepareNativeTerrainInhibitors(preparedFixture(0x91)),
    /snapshot differs from verified loss history/,
  );
  assert.throws(
    () => prepareNativeTerrainInhibitors(preparedFixture(0x80)),
    /Missing indexed inhibitor state/,
  );
});

test("only reports exact snapshot state when the loss history is unavailable", () => {
  const overlay = prepareNativeTerrainInhibitors(preparedFixture(0x81, false));
  assert.equal(overlay.losses, null);
  assert.equal(overlay.read(0).inhibitors[0].seekState, "alive");
  assert.equal(overlay.read(8).inhibitors[0].seekState, "unknown");
  assert.equal(overlay.read(10).inhibitors[0].seekState, "destroyed");
});
