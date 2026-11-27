import assert from "node:assert/strict";
import test from "node:test";
import { prepareNativeTerrainInhibitors } from "./native-terrain-inhibitors.mjs";
import { readCurrentInhibitorPacketState } from "./native-terrain-inhibitor-packet.mjs";

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
          payload: Uint8Array.of(
            index === 0 && timeSeconds >= 10 ? lateValue : 0x91,
          ),
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

test("keeps current losses while leaving unsupported and returned states unresolved between snapshots", () => {
  const options = { allowCurrentBuild: true };
  for (const value of [0x80, 0x91]) {
    const prepared = preparedFixture(value);
    prepared.packetReader.build = "16.23.841.8428";
    const overlay = prepareNativeTerrainInhibitors(prepared, options);
    assert.equal(overlay.losses.length, 1);
    assert.equal(overlay.read(12).inhibitors[0].seekState, "unknown");
    if (value === 0x80) {
      assert.deepEqual(overlay.unresolvedSnapshotStates, [
        { context: 1073742125, timeSeconds: 10 },
      ]);
    } else {
      assert.equal(overlay.renderableLosses.length, 0);
      assert.equal(overlay.presentationOmissions[0].context, 1073742125);
      assert.equal(overlay.read(10).inhibitors[0].seekState, "alive");
    }
  }
});

function currentLifecycle() {
  const prepared = preparedFixture(0x91);
  const { packetReader } = prepared;
  packetReader.build = "16.23.841.8428";
  const snapshot = (timeSeconds) =>
    packetReader.read(timeSeconds).packets.map((packet, blockOffset) => ({
      ...packet,
      blockOffset,
      timeSeconds,
    }));
  const gameplay = (timeSeconds, hex, blockOffset) => ({
    stream: 1,
    chunkOffset: 150,
    blockOffset,
    timeSeconds,
    secondTimeBits: 0,
    explicitOpcode: 947,
    marker: 0,
    paramBits: 1073742125,
    payload: Buffer.from(hex, "hex"),
  });
  return {
    prepared,
    options: {
      allowCurrentBuild: true,
      readCurrentInhibitorPacket: readCurrentInhibitorPacketState,
      currentInhibitorPackets: [
        ...snapshot(0),
        gameplay(8, "8a6ec4", 0),
        gameplay(9, "926ec4", 1),
        ...snapshot(10),
      ],
    },
  };
}

test("applies the original loss and return clocks for current exact packets", () => {
  const { prepared, options } = currentLifecycle();
  const overlay = prepareNativeTerrainInhibitors(prepared, options);
  assert.deepEqual(overlay.inactivity.get(1073742125), [[8, 9]]);
  assert.deepEqual(overlay.unresolvedSnapshotStates, []);
  assert.deepEqual(overlay.presentationOmissions, []);
  const stateAt = (time) => overlay.read(time).inhibitors[0].seekState;
  assert.deepEqual(
    [stateAt(7.99), stateAt(8), stateAt(8.99), stateAt(9)],
    ["alive", "destroyed", "destroyed", "alive"],
  );
});

test("rejects current inhibitor lifecycle when gameplay and verified history or snapshots disagree", () => {
  const { prepared, options } = currentLifecycle();
  const packets = options.currentInhibitorPackets;
  const without = (index) => ({
    ...options,
    currentInhibitorPackets: packets.filter(
      (_, position) => position !== index,
    ),
  });
  assert.throws(
    () => prepareNativeTerrainInhibitors(prepared, without(6)),
    /without a preceding verified loss/,
  );
  assert.throws(
    () => prepareNativeTerrainInhibitors(prepared, without(7)),
    /snapshot differs from recorded lifecycle/,
  );
  assert.throws(
    () => prepareNativeTerrainInhibitors(prepared, without(8)),
    /missing an indexed snapshot state/,
  );
  packets[6].secondTimeBits++;
  assert.throws(
    () => prepareNativeTerrainInhibitors(prepared, options),
    /differs from verified loss history/,
  );
});
