import { expect, test } from "vitest";
import { createTurretSnapshotCollector } from "./replay-turret-state.mjs";
import type { ReplayObservations } from "@scout-for-lol/replay/observations";
import type {
  ReplayPacketReader,
  ReplayRawPacket,
} from "@scout-for-lol/replay/packets";

const times = [0, 1, 2, 3];
function* unexpectedPackets(): Generator<ReplayRawPacket, void, unknown> {
  yield unexpectedPacket();
}

function unexpectedPacket(): never {
  throw new Error("Turret lookup must not expand packet windows");
}
const keyframes = times.map((timeSeconds) => ({
  chunkId: timeSeconds,
  chunkOffset: timeSeconds * 10,
  storedChunkBytes: 10,
  timeSeconds,
  secondTimeBits: 0,
  predecessorChunkId: 0,
  predecessorStream: 4,
}));
const reader: ReplayPacketReader = {
  build: "16.23.840.6595",
  protocol: "8bbfcd5af2bc92db",
  durationSeconds: 4,
  durationMilliseconds: 4000,
  keyframes,
  read(timeSeconds, options) {
    options?.signal?.throwIfAborted();
    const keyframe = keyframes.findLast(
      (item) => item.timeSeconds <= timeSeconds,
    );
    if (keyframe === undefined) throw new Error("No keyframe");
    return { keyframe, packets: unexpectedPackets() };
  },
};
const history = {
  turrets: [
    {
      kind: "turret-destruction",
      context: 100,
      timeSeconds: 2,
      secondTimeBits: 0,
      defendingPartition: null,
    },
  ],
} satisfies Pick<ReplayObservations, "turrets">;

function packet(
  frame: number,
  params: Partial<Omit<ReplayRawPacket, "timeSeconds">> = {},
): Omit<ReplayRawPacket, "timeSeconds"> {
  return {
    chunkId: frame,
    chunkOffset: frame * 10,
    storedChunkBytes: 10,
    stream: 2,
    blockOffset: 0,
    marker: 1,
    firstTimeBits: 0,
    secondTimeBits: 0,
    explicitOpcode: 1012,
    paramBits: 100,
    payload: new Uint8Array(41).fill(8),
    ...params,
  };
}

test("seeks exact validated turret facts without opening a packet window", () => {
  const collector = createTurretSnapshotCollector();
  collector.observeRawPacket(packet(0));
  collector.observeRawPacket(packet(0, { blockOffset: 1, paramBits: 101 }));
  collector.observeRawPacket(packet(1, { explicitOpcode: 1167 }));
  collector.observeRawPacket(packet(2));
  collector.observeRawPacket(
    packet(3, { explicitOpcode: 1012, paramBits: 101 }),
  );
  collector.observeRawPacket(
    packet(3, {
      blockOffset: 1,
      explicitOpcode: null,
      marker: 33,
      paramBits: 255,
      payload: new Uint8Array(41),
    }),
  );
  const read = collector.finish(reader, history);
  expect(read(3)).toEqual({
    keyframeTimeSeconds: 3,
    turrets: [
      {
        context: 100,
        defendingPartition: null,
        keyframeState: "dead",
        seekState: "dead",
      },
    ],
  });
  expect(read(1)?.turrets[0]).toMatchObject({
    keyframeState: "unknown-missing",
    seekState: "alive",
  });
  expect(read(2)?.turrets[0]).toMatchObject({
    keyframeState: "unknown-same-time",
    seekState: "dead",
  });
  expect(read(0)?.turrets[0]).toMatchObject({
    keyframeState: "alive",
    seekState: "alive",
  });
  expect(() =>
    read(0, { signal: AbortSignal.abort(new Error("Cancelled")) }),
  ).toThrow("Cancelled");
});

test("distinguishes unavailable evidence and an independently verified zero-loss cohort", () => {
  const collector = createTurretSnapshotCollector();
  collector.observeRawPacket(packet(0));
  expect(collector.finish(reader, { turrets: null })(0)).toBeNull();
  expect(collector.finish(reader, { turrets: [] })(0)).toEqual({
    keyframeTimeSeconds: 0,
    turrets: [],
  });
});

test("retains a verified loss when there is no opening turret marker", () => {
  const collector = createTurretSnapshotCollector();
  collector.observeRawPacket(packet(0, { explicitOpcode: 1167 }));
  collector.observeRawPacket(packet(3, { explicitOpcode: 1167 }));
  const read = collector.finish(reader, history);
  expect(read(0)?.turrets[0]).toMatchObject({
    keyframeState: "unknown-missing",
    seekState: "alive",
  });
  expect(read(3)?.turrets[0]).toMatchObject({
    keyframeState: "unknown-missing",
    seekState: "dead",
  });
});

test("rejects an inconsistent bit and a contradictory duplicate", () => {
  const collector = createTurretSnapshotCollector();
  collector.observeRawPacket(packet(0));
  const dead = packet(0, { blockOffset: 1, payload: new Uint8Array(41) });
  collector.observeRawPacket(dead);
  collector.observeRawPacket(packet(3));
  const read = collector.finish(reader, history);
  expect(() => read(0)).toThrow("Conflicting turret bits");
  expect(() => read(3)).toThrow("disagrees with verified loss history");
});
