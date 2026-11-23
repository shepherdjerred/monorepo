import { describe, expect, test } from "bun:test";
import { readNativeTerrainReturnPosition } from "./native-terrain-motion-return.mjs";
import { sampleNativeTerrainMotion } from "./native-terrain-motion-sample.mjs";
import { prepareNativeTerrainMotion } from "./native-terrain-motion.mjs";

const identity = { build: "16.23.840.6595", protocol: "8bbfcd5af2bc92db" };
const first = 1000;
const second = 1234;
const foreign = 1235;

function packet(timeSeconds, explicitOpcode, { stream = 1, ...rest } = {}) {
  return {
    stream,
    explicitOpcode,
    timeSeconds,
    blockOffset: 1,
    marker: 0,
    paramBits: 0,
    secondTimeBits: 0,
    payload: new Uint8Array(0),
    ...rest,
  };
}

function path(entityId, speed, encodedWaypoints, motion = null) {
  return { entityId, speed, encodedWaypoints, motion };
}

function returnPositionBody(x, z, extraScalar = false) {
  const vector = new DataView(new ArrayBuffer(8));
  vector.setFloat32(0, z);
  vector.setFloat32(4, x);
  const encoded = Uint8Array.from(new Uint8Array(vector.buffer), (value) => {
    const byte = ((value - 0x10) & 0xff) ^ 0x38;
    const swapped = ((byte >>> 1) & 0x55) | ((byte << 1) & 0xaa);
    return ((swapped - 0xe1) & 0xff) ^ 0xc7;
  });
  return extraScalar
    ? Uint8Array.of(0x56, 0, 0, 0, 0, ...encoded)
    : Uint8Array.of(0x50, ...encoded);
}

function fixture() {
  const death = {
    kind: "champion-death",
    context: first,
    timeSeconds: 8,
    secondTimeBits: 111,
  };
  const revive = {
    kind: "champion-return",
    context: first,
    timeSeconds: 10,
    secondTimeBits: 333,
  };
  const prepared = {
    packetReader: { ...identity, durationSeconds: 30 },
    observations: {
      ...identity,
      roster: new Array(3),
      binding: {
        verified: [
          { context: first, footerRow: 1 },
          { context: second, footerRow: 2 },
        ],
        events: [death],
      },
      returns: [revive],
    },
  };
  const keyframes = {
    frames: [
      { timeSeconds: 0, markers: [{ participantId: first, x: 1, z: 1 }] },
      { timeSeconds: 7, markers: [{ participantId: first, x: 19, z: 10 }] },
      { timeSeconds: 9, markers: [] },
    ],
    coverage: { admittedMarkers: 2, missingPacket: 1 },
  };
  const packets = [
    packet(0, 96, { stream: 2, blockOffset: 0, records: [] }),
    packet(2, 96, {
      blockOffset: 0,
      syncId: 100,
      records: [
        path(first, 5, [
          [0, 0],
          [5, 0],
          [5, 10],
        ]),
        path(second, 2, [
          [0, 0],
          [0, 10],
        ]),
        path(foreign, 200, [
          [0, 0],
          [100, 200],
        ]),
      ],
    }),
    packet(3, 309, {
      updates: [
        { entityId: first, moveSpeed: 10 },
        { entityId: second, moveSpeed: 0 },
      ],
    }),
    packet(4, 309, { updates: [{ entityId: second, moveSpeed: 4 }] }),
    packet(4, 96, {
      syncId: 99,
      records: [path(first, 1, [[1000, 1000]])],
    }),
    packet(7, 1174, {
      syncId: 101,
      records: [
        path(
          first,
          30,
          [
            [6, 4],
            [25, 4],
          ],
          { speed: 4 },
        ),
      ],
    }),
    packet(7, 309, { updates: [{ entityId: first, moveSpeed: 800 }] }),
    packet(8, 172, {
      paramBits: first,
      payload: new Uint8Array(116),
      secondTimeBits: death.secondTimeBits,
    }),
    packet(9, 96, { syncId: 102, records: [path(first, 0, [[1000, 1000]])] }),
    packet(10, 96, { syncId: 103, records: [path(first, 0, [[1000, 1000]])] }),
    packet(10, 1098, {
      paramBits: first,
      secondTimeBits: revive.secondTimeBits,
      payload: Uint8Array.of(0x51),
    }),
    packet(11, 309, { updates: [{ entityId: second, moveSpeed: 20 }] }),
    packet(12, 96, { syncId: 104, records: [path(first, 0, [[3, 4]])] }),
    packet(12, null, { syncId: 105, records: [path(first, 0, [[2, 3]])] }),
  ];
  const options = {
    waypointOrigin: [10, 10],
    // The mock readers pass their packets' decoded records through.
    readWaypoints: (_opcode, payload) => payload,
    readMoveSpeed: (payload, ids) => ({
      updates: payload.updates.filter(({ entityId }) => ids.has(entityId)),
    }),
  };
  const timedPackets = packets.map((entry) =>
    entry.records || entry.updates ? { ...entry, payload: entry } : entry,
  );
  return { prepared, keyframes, timedPackets, options };
}

function prepare({ prepared, keyframes, timedPackets, options } = fixture()) {
  return prepareNativeTerrainMotion(prepared, keyframes, timedPackets, options);
}

function actor(sample, participantId) {
  return sample.markers.find(
    (marker) => marker.participantId === participantId,
  );
}

describe("exact-build continuous champion motion", () => {
  test("integrates ordinary speed writes in recorded order and samples turns", () => {
    const { sample, coverage } = prepare();
    expect(actor(sample(2.5), first)).toMatchObject({
      x: 12.5,
      z: 10,
      moving: true,
      direction: [1, 0],
      source: "waypoint",
    });
    expect(actor(sample(4.5), first)).toMatchObject({
      x: 20,
      z: 20,
      moving: true,
      direction: [0, 1],
    });
    expect(actor(sample(3.5), second)).toMatchObject({
      x: 10,
      z: 12,
      moving: false,
    });
    expect(actor(sample(4.5), second)).toMatchObject({
      x: 10,
      z: 14,
      moving: true,
    });
    expect(actor(sample(7.5), first)).toMatchObject({
      x: 24,
      z: 18,
      moving: true,
    });
    expect(actor(sample(15), second)).toMatchObject({
      x: 10,
      z: 30,
      moving: false,
    });
    expect(actor(sample(4.5), foreign)).toBeUndefined();
    expect(coverage).toMatchObject({
      verifiedParticipants: 2,
      unresolvedParticipants: 1,
      participantsWithMultiPointPaths: 2,
      participantsWithAppliedSpeedChanges: 2,
    });
    expect(coverage.participants[0]).toMatchObject({
      participantId: first,
      staleWaypoints: 1,
      deadWaypoints: 2,
      motionWaypoints: 1,
      appliedSpeedChanges: 1,
    });
    expect(coverage.participants[1]).toMatchObject({
      speedWrites: 3,
      appliedSpeedChanges: 2,
    });
  });

  test("uses exact sampled keyframes and clears stale positions across lives", () => {
    const { sample, motion } = prepare();
    expect(actor(sample(0), first)).toMatchObject({
      x: 1,
      z: 1,
      source: "keyframe",
    });
    expect(actor(sample(1), first)).toMatchObject({
      x: 1,
      z: 1,
      source: "keyframe-hold",
    });
    expect(actor(sample(7), first)).toMatchObject({
      x: 19,
      z: 10,
      source: "keyframe",
    });
    expect(sample(9).coverage).toMatchObject({ dead: 1, missing: 0 });
    expect(actor(sample(9), first)).toBeUndefined();
    expect(sample(10).coverage).toMatchObject({ dead: 0, missing: 1 });
    expect(actor(sample(11), first)).toBeUndefined();
    expect(actor(sample(12), first)).toMatchObject({
      x: 14,
      z: 16,
      moving: false,
    });
    const wire = JSON.parse(JSON.stringify(motion));
    const at = (time) => sampleNativeTerrainMotion(wire, time);
    const later = at(23);
    expect(at(5)).toEqual(sample(5));
    expect(at(23)).toEqual(later);
    expect(() => at(31)).toThrow("outside the recorded replay");
  });

  test("seeds zero-header paths from a current-life replication write", () => {
    const input = fixture();
    const zeroPath = (time, syncId) =>
      packet(time, 96, {
        payload: {
          syncId,
          records: [
            path(first, 0, [
              [0, 0],
              [20, 0],
            ]),
          ],
        },
      });
    const timedPackets = [
      ...input.timedPackets,
      packet(7.25, 309, {
        payload: { updates: [{ entityId: first, moveSpeed: 12 }] },
      }),
      zeroPath(7.5, 101),
      packet(8.5, 309, {
        payload: { updates: [{ entityId: first, moveSpeed: 800 }] },
      }),
      zeroPath(11.5, 103),
    ].sort((a, b) => a.timeSeconds - b.timeSeconds);
    const { sample, coverage } = prepare({ ...input, timedPackets });

    expect(actor(sample(7.75), first)).toMatchObject({
      x: 13,
      z: 10,
      moving: true,
    });
    expect(actor(sample(11.75), first)).toMatchObject({
      x: 10,
      z: 10,
      moving: false,
    });
    expect(coverage.participants[0].zeroHeaderPathsUsingMoveSpeed).toBe(1);
  });

  test("holds the recorded return position until new path evidence", () => {
    const input = fixture();
    const payload = returnPositionBody(100.25, 200.5, true);
    const timedPackets = input.timedPackets.map((entry) =>
      entry.explicitOpcode === 1098 ? { ...entry, payload } : entry,
    );
    const { sample, coverage } = prepare({ ...input, timedPackets });
    expect(actor(sample(9.999), first)).toBeUndefined();
    expect(actor(sample(10), first)).toMatchObject({
      x: 100.25,
      z: 200.5,
      source: "return",
      moving: false,
    });
    expect(sample(11).coverage.returnAnchor).toBe(1);
    expect(actor(sample(12), first).source).toBe("waypoint");
    expect(coverage.participants[0].returnPositions).toBe(1);
    expect(
      readNativeTerrainReturnPosition(returnPositionBody(1.5, -2)),
    ).toEqual({
      x: 1.5,
      z: -2,
    });
    expect(() =>
      readNativeTerrainReturnPosition(payload.subarray(0, -1)),
    ).toThrow("Invalid champion return packet width");
    expect(() =>
      readNativeTerrainReturnPosition(returnPositionBody(Infinity, 1)),
    ).toThrow("Invalid champion return position coordinates");
  });

  test("rejects missing lifecycle evidence and out-of-order packet clocks", () => {
    const input = fixture();
    const missing = input.timedPackets.filter(
      ({ explicitOpcode }) => explicitOpcode !== 1098,
    );
    expect(() => prepare({ ...input, timedPackets: missing })).toThrow(
      "Missing gameplay packet for verified champion lifecycle",
    );
    expect(() =>
      prepare({
        ...input,
        timedPackets: [...input.timedPackets, packet(1, 96)],
      }),
    ).toThrow("Invalid gameplay motion packet clock");
  });
});
