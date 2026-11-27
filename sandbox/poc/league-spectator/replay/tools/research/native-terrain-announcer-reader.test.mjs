import { expect, test } from "bun:test";
import {
  createCurrentAnnouncement880Reader,
  createCurrentMap11AnnouncerCollector,
} from "./native-terrain-announcer-reader.mjs";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";

const replay = {
  build: currentTerrainPositionBuild,
  protocol: terrainPositionProtocol,
  duration: 40,
};
const substitution = Uint8Array.from({ length: 256 }, (_, byte) => byte);
const start = Uint8Array.of(0x6f, 0xa2, 0x9b, 0x03);
const minions = Uint8Array.of(0xef, 0xa2, 0x1c, 0x03);

test("decodes the native bounded enum across selector branches", () => {
  const read = createCurrentAnnouncement880Reader(replay, substitution);
  expect(read(start)).toBe(159);
  expect(read(minions)).toBe(157);
  expect(read(start.subarray(0, -1))).toBeNull();
  expect(read(Uint8Array.of(...minions, 0))).toBeNull();
  expect(read(Uint8Array.of(0x6f, 0, 0))).toBeNull();
  expect(() =>
    createCurrentAnnouncement880Reader(
      { ...replay, build: "16.23.840.6595" },
      substitution,
    ),
  ).toThrow("reviewed current");
});

test("collects ordinary global triggers and counts omissions", () => {
  const collector = createCurrentMap11AnnouncerCollector(
    replay,
    substitution,
    new Map([[159, 133352710]]),
  );
  const packet = {
    stream: 1,
    explicitOpcode: 880,
    blockOffset: 0,
    chunkOffset: 8,
    paramBits: 0,
    marker: 0,
    timeSeconds: 20,
    payload: start,
  };
  collector.observe(packet);
  collector.observe({ ...packet, stream: 2 });
  collector.observe({ ...packet, paramBits: 1 });
  collector.observe({
    ...packet,
    explicitOpcode: undefined,
    marker: 32,
    paramBits: 255,
    blockOffset: 9,
    timeSeconds: 30,
    payload: minions,
  });
  collector.observe({
    ...packet,
    blockOffset: 10,
    payload: start.subarray(0, -1),
  });
  expect(collector.finish()).toEqual({
    cues: [
      {
        event: 159,
        mediaId: 133352710,
        timeSeconds: 20,
        chunkOffset: 8,
        blockOffset: 0,
      },
    ],
    omittedByEvent: { 157: 1 },
    rejectedBodies: 1,
  });
});
