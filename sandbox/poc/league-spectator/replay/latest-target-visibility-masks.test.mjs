import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { createLatestTargetVisibilityMaskInputs } from "./latest-target-visibility-masks.mjs";

const cache = resolve(import.meta.dir, "../../../../.cache/replay-spike");
const profile = await Bun.file(
  `${cache}/public/decoder-16.21-macos/profile.json`,
).json();
const image = await Bun.file(
  `${cache}/public/decoder-16.21-macos/image.bin`,
).bytes();
const packageBytes = await Bun.file(
  `${cache}/public/latest-target-visibility-masks/package.json`,
).bytes();
const reader = await createLatestTargetVisibilityMaskInputs({
  profile,
  image,
  packageBytes,
});
const data = JSON.parse(new TextDecoder().decode(packageBytes));
const observation = (opcode, byte = 0) => {
  const packet = data.packets.find((p) => p.opcode === opcode),
    object = new Uint8Array(packet.objectBytes);
  const view = new DataView(object.buffer);
  view.setBigUint64(0, BigInt(profile.imageBase + packet.vtableRva), true);
  view.setUint32(8, opcode, true);
  view.setUint32(12, 0x4000003d, true);
  if (opcode !== 918) object[16] = byte;
  return { complete: true, object, heap: object.slice() };
};

test("mask reader preserves all encoded slot bytes without accepting live visibility", () => {
  for (const opcode of [48, 582])
    for (let byte = 0; byte < 256; byte++) {
      const decoded = reader.read(observation(opcode, byte));
      expect(decoded.encodedViewSlotByte).toBe(byte);
      expect(decoded.acceptedByLiveUnit).toBeNull();
      expect(decoded.visible).toBeNull();
      expect(decoded.opcode).toBe(opcode);
    }
});
test("918 retains original raw header and has no invented mask byte", () => {
  const decoded = reader.read(observation(918));
  expect(decoded.status).toBe("raw-target-visibility-reset-request");
  expect(decoded.entityId).toBe(0x4000003d);
  expect(decoded.encodedViewSlotByte).toBeUndefined();
  expect(decoded.rawObjectHex.length).toBe(32);
  expect(Object.isFrozen(decoded)).toBe(true);
});
test("incomplete, inconsistent heap, wrong types and wrong object bounds fail", () => {
  const source = observation(48, 255);
  expect(() => reader.read({ ...source, complete: false })).toThrow();
  const heapMismatch = structuredClone(source);
  heapMismatch.heap[16] = 0;
  expect(() => reader.read(heapMismatch)).toThrow();
  for (const edit of [
    (v) => v.setBigUint64(0, 0n, true),
    (v) => v.setUint32(8, 822, true),
  ]) {
    const value = structuredClone(source);
    edit(new DataView(value.object.buffer));
    value.heap.set(value.object);
    expect(() => reader.read(value)).toThrow();
  }
  expect(() =>
    reader.read({ ...source, object: source.object.slice(0, 19) }),
  ).toThrow();
});
test("foreign builds, packet layouts and stale package bytes fail", async () => {
  await expect(
    createLatestTargetVisibilityMaskInputs({
      profile: { ...profile, clientVersion: "foreign" },
      image,
      packageBytes,
    }),
  ).rejects.toThrow();
  const changed = structuredClone(profile);
  changed.packets[48].entryRva++;
  await expect(
    createLatestTargetVisibilityMaskInputs({
      profile: changed,
      image,
      packageBytes,
    }),
  ).rejects.toThrow();
  await expect(
    createLatestTargetVisibilityMaskInputs({
      profile,
      image,
      packageBytes: new Uint8Array(),
    }),
  ).rejects.toThrow();
});
