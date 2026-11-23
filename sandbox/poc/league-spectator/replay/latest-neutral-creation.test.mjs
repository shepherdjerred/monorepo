import { expect, test } from "bun:test";
import {
  assertNeutralCreationCodecs,
  decodeNeutralCreationObservation,
  createLatestNeutralCreationReader,
} from "./latest-neutral-creation.mjs";
function fixture() {
  const inputOffsets = {
    entityId: [92, 93, 94, 95],
    requestedSkinId: [184, 185, 186, 187],
    nativeTeamEnum: [80],
    scalarArgumentBits: [16, 17, 18, 19],
    firstVectorArgument: Array.from({ length: 12 }, (_, i) => 40 + i),
    secondVectorArgument: Array.from({ length: 12 }, (_, i) => 172 + i),
  };
  const metadata = {
    opcode: 745,
    objectBytes: 200,
    heapBase: 0x10200000,
    strings: {
      initialAnimation: 24,
      name: 56,
      secondaryName: 104,
      character: 152,
    },
    fields: Object.fromEntries(
      Object.entries(inputOffsets).map(([key, offsets]) => [
        key,
        {
          bytes: offsets.length,
          inputOffsets: offsets,
          decode: offsets.map(() => Array.from({ length: 256 }, (_, i) => i)),
        },
      ]),
    ),
  };
  const heap = new Uint8Array(512),
    object = heap.subarray(0, 200),
    view = new DataView(heap.buffer);
  view.setUint32(8, 745, true);
  view.setUint32(12, 123, true);
  view.setUint32(92, 123, true);
  view.setUint32(184, 4, true);
  view.setUint8(80, 3);
  for (const [at, values] of [
    [40, [1.25, 2.5, 3.75]],
    [172, [4, 5, 6]],
  ])
    values.forEach((v, i) => view.setFloat32(at + i * 4, v, true));
  let cursor = 208;
  for (const [key, value] of Object.entries({
    initialAnimation: "spawn",
    name: "Monster.1",
    secondaryName: "Monster.1",
    character: "NativeMonster",
  })) {
    const data = new TextEncoder().encode(value),
      at = metadata.strings[key];
    heap.set(data, cursor);
    view.setBigUint64(at, BigInt(metadata.heapBase + cursor), true);
    view.setUint32(at + 8, data.length, true);
    view.setUint32(at + 12, data.length + 1, true);
    cursor += data.length + 1;
  }
  return { metadata, observation: { complete: true, object, heap }, view };
}
test("neutral field controls preserve native identities, requested skins and both factory vectors without accepting a world actor", () => {
  const { metadata, observation } = fixture(),
    out = decodeNeutralCreationObservation(metadata, observation);
  expect(out.entityId).toBe(123);
  expect(out.character).toBe("NativeMonster");
  expect(out.requestedSkinId).toBe(4);
  expect(out.nativeTeamEnum).toBe(3);
  expect(out.firstVectorArgument).toEqual([1.25, 2.5, 3.75]);
  expect(out.secondVectorArgument).toEqual([4, 5, 6]);
  expect(out.initialAnimation).toBe("spawn");
  expect(out.resourceSkinResolved).toBe(false);
  expect(out.nativeWorldAcceptance).toBe(false);
});
test("wrong class, mismatched original identity, corrupt strings and nonfinite native vectors reject", () => {
  for (const mutate of [
    (f) => f.view.setUint32(8, 849, true),
    (f) => f.view.setUint32(12, 124, true),
    (f) => f.view.setBigUint64(152, 0xffffffffffffffffn, true),
    (f) => f.view.setUint32(160, 1025, true),
    (f) => f.observation.heap.fill(1, 208),
    (f) => f.view.setUint32(40, 0x7fc00000, true),
    (f) => (f.observation.object = new Uint8Array(199)),
  ]) {
    const f = fixture();
    mutate(f);
    expect(() =>
      decodeNeutralCreationObservation(f.metadata, f.observation),
    ).toThrow();
  }
  expect(() =>
    decodeNeutralCreationObservation(fixture().metadata, null),
  ).toThrow("Complete original745");
});
test("unknown field layouts and incomplete byte permutations cannot authorize a nearby packet grammar", () => {
  for (const mutate of [
    (f) => f.metadata.fields.entityId.inputOffsets[0]++,
    (f) => f.metadata.fields.entityId.decode[0].pop(),
    (f) => (f.metadata.strings.character = 153),
  ]) {
    const f = fixture();
    mutate(f);
    expect(() => assertNeutralCreationCodecs(f.metadata)).toThrow();
  }
});
test("native reader factory requires the independently pinned original package", async () => {
  await expect(
    createLatestNeutralCreationReader({
      profile: { clientVersion: "16.22.834.8910" },
      image: new Uint8Array(),
      packageBytes: new TextEncoder().encode("{}"),
    }),
  ).rejects.toThrow("Pinned original745");
});
