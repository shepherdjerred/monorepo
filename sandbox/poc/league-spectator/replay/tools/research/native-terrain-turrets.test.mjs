import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCurrentTurretSnapshotCollector,
  prepareNativeTerrainTurrets,
} from "./native-terrain-turrets.mjs";

const nameForms = [
  [0x3b, 26, [12, 9, 10, 23, 16, 21, 22, 19, 20, 17]],
  [0x65, 26, [226, 235, 50, 103, 59, 153, 200, 44, 28, 117]],
  [0x8f, 8, [129, 6, 163, 248, 227, 15, 209, 132, 59, 188]],
];

function namePacket(hash, index) {
  const [separator, start, symbols] = nameForms[index % nameForms.length];
  const digits = Array.from(String(hash), (digit) => symbols[Number(digit)]);
  const payload = new Uint8Array(start + digits.length + 3);
  if (start === 8) {
    digits.reverse();
    payload[7] = separator;
  } else {
    for (const offset of [12, 19, 22, 25]) payload[offset] = separator;
  }
  payload.set(digits, start);
  payload[start + digits.length] = separator;
  return payload;
}

function fixture() {
  const receipt = {
    installedCompatibilityVersion: "16.23.8406595+branch",
    installedSha256:
      "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a",
    entryPath: "data/maps/mapgeometry/map11/base_srx.materials.bin",
    attackableType: 0,
    uniqueMatches: 24,
    records: Array.from({ length: 24 }, (_, index) => ({
      mapNameHash: 12345670 + index * 23156711,
      installedOffset: index * 10,
      translation: [index, 0, -index],
    })),
  };
  const packets = receipt.records.flatMap(({ mapNameHash }, index) => [
    {
      stream: 2,
      chunkOffset: 1,
      explicitOpcode: 921,
      paramBits: 1000 - index,
      payload: namePacket(mapNameHash, index),
    },
    {
      stream: 2,
      chunkOffset: 1,
      explicitOpcode: 1012,
      marker: 32,
      paramBits: 0,
      payload: new Uint8Array(41),
    },
  ]);
  const turrets = [0, 1, 2].map((index) => ({
    context: 1000 - index,
    timeSeconds: index + 1,
    defendingPartition: index % 2,
  }));
  const prepared = {
    packetReader: {
      build: "16.23.840.6595",
      protocol: "8bbfcd5af2bc92db",
      read(time) {
        assert.equal(time, 0);
        return { keyframe: { timeSeconds: time, chunkOffset: 1 }, packets };
      },
    },
    observations: { turrets },
    readTurretState(time) {
      return {
        keyframeTimeSeconds: 0,
        turrets: turrets.map(({ context, timeSeconds }) => ({
          context,
          keyframeState: "unknown-missing",
          seekState: time < timeSeconds ? "alive" : "dead",
        })),
      };
    },
  };
  receipt.records.reverse();
  return { prepared, receipt, packets };
}

test("binds forward and reversed packet names to unordered authored coordinates", () => {
  const { prepared, receipt } = fixture();
  const overlay = prepareNativeTerrainTurrets(prepared, receipt);
  assert.deepEqual(
    overlay.losses.map(({ worldPosition }) => worldPosition),
    [
      [0, 0, -0],
      [1, 0, -1],
      [2, 0, -2],
    ],
  );
  assert.deepEqual(
    overlay
      .read(2)
      .turrets.map(({ keyframeState, seekState }) => [
        keyframeState,
        seekState,
      ]),
    [
      ["unknown-missing", "dead"],
      ["unknown-missing", "dead"],
      ["unknown-missing", "alive"],
    ],
  );
});

test("retains a disputed turret event while omitting its presentation", () => {
  const { prepared, receipt } = fixture();
  const currentContext = prepared.observations.turrets[0].context;
  const lossTime = prepared.observations.turrets[0].timeSeconds;
  const snapshotTime = 8;
  receipt.installedCompatibilityVersion = "16.23.8418428+branch";
  prepared.packetReader.build = "16.23.841.8428";
  prepared.packetReader.keyframes = [
    { timeSeconds: 0, chunkOffset: 1 },
    { timeSeconds: lossTime, chunkOffset: 2 },
    { timeSeconds: snapshotTime, chunkOffset: 3 },
  ];
  const readOpening = prepared.packetReader.read;
  const payload = new Uint8Array(41);
  payload[13] = 0x08;
  prepared.packetReader.read = (time) =>
    time === 0
      ? readOpening(time)
      : {
          keyframe: prepared.packetReader.keyframes.find(
            ({ timeSeconds }) => timeSeconds === time,
          ),
          packets: [
            {
              stream: 2,
              chunkOffset: time === lossTime ? 2 : 3,
              explicitOpcode: 1012,
              paramBits: currentContext,
              payload,
            },
          ],
        };
  const overlay = prepareNativeTerrainTurrets(prepared, receipt, {
    allowCurrentBuild: true,
  });
  assert.equal(overlay.losses.length, 3);
  assert.equal(overlay.renderableLosses.length, 2);
  assert.equal(overlay.presentationOmissions[0].context, currentContext);
  assert.equal(
    overlay.presentationOmissions[0].snapshotTimeSeconds,
    snapshotTime,
  );
  assert.equal(overlay.presentationOmissions[0].snapshotStateByte, 0x08);
});

test("rejects missing or conflicting packet identities and unbound losses", () => {
  const { prepared, receipt, packets } = fixture();
  const [name] = packets.splice(0, 1);
  assert.throws(
    () => prepareNativeTerrainTurrets(prepared, receipt),
    /one opening structure name/,
  );
  packets.unshift(name, name);
  assert.throws(
    () => prepareNativeTerrainTurrets(prepared, receipt),
    /one opening structure name/,
  );
  packets.shift();
  const originalPayload = name.payload;
  name.payload = namePacket(receipt.records.at(-2).mapNameHash, 0);
  assert.throws(
    () => prepareNativeTerrainTurrets(prepared, receipt),
    /non-unique opening Map11 structure placement/,
  );
  name.payload = originalPayload;
  prepared.observations.turrets[0].context = 500;
  assert.throws(
    () => prepareNativeTerrainTurrets(prepared, receipt),
    /no verified Map11 position/,
  );
});

test("rejects an incompatible build or installed receipt", () => {
  const { prepared, receipt } = fixture();
  assert.throws(
    () =>
      prepareNativeTerrainTurrets(prepared, {
        ...receipt,
        installedSha256: "",
      }),
    /verified exact-build installed Map11 placements/,
  );
  prepared.packetReader.protocol = "unknown";
  assert.throws(
    () => prepareNativeTerrainTurrets(prepared, receipt),
    /exact-build Map11 replay turret observations/,
  );
});

test("reconciles incremental indexed snapshots without treating the loss clock as state evidence", () => {
  const keyframes = [0, 10, 20].map((timeSeconds, chunkOffset) => ({
    timeSeconds,
    chunkOffset,
  }));
  const collector = createCurrentTurretSnapshotCollector(
    { keyframes },
    [101, 102],
  );
  function observe(chunkOffset, context, state, stream = 2) {
    const payload = new Uint8Array(41);
    payload[13] = state;
    collector.observe({
      stream,
      chunkOffset,
      explicitOpcode: 1012,
      paramBits: context,
      payload,
    });
  }
  observe(0, 101, 8);
  observe(0, 102, 8);
  observe(1, 101, 8); // Same clock as the loss, so it is not corroborating.
  observe(2, 101, 0);
  observe(2, 102, 8);
  observe(2, 102, 0, 1); // A gameplay envelope cannot contradict a snapshot.
  const snapshots = collector.finish();
  const losses = [{ context: 101, timeSeconds: 10 }];
  const instances = [
    { context: 101, destroyedAtSeconds: 10 },
    { context: 102, destroyedAtSeconds: null },
  ];
  assert.deepEqual(snapshots.presentationOmissions(losses), []);
  assert.deepEqual(snapshots.corroborateSnapshots(instances), {
    lastSnapshotSeconds: 20,
    keyframes: 3,
    counts: {
      101: { alive: 1, dead: 1, missing: 0 },
      102: { alive: 2, dead: 0, missing: 1 },
    },
  });
  observe(2, 101, 8);
  assert.throws(
    () => snapshots.presentationOmissions(losses),
    /Conflicting turret bits/,
  );
  assert.throws(
    () => snapshots.corroborateSnapshots(instances),
    /Conflicting recorded turret snapshot/,
  );
});
