import { expect, test } from "bun:test";
import {
  deriveSelectedMaterialSelectionInput as derive,
  assertSelectedBasicMaterialDefinitionInputs as basic,
} from "./latest-selected-material-selection-input.mjs";
async function fixture(kind) {
  const base = ".cache/replay-spike/public",
    bound = await Bun.file(
      `${base}/decoder-16.21-macos/vfx-bound-quads.json`,
    ).json(),
    ref = bound.templates.find((row) => row.primitiveKind === kind),
    graph = await Bun.file(`${base}/decoder-16.21-macos/${ref.file}`).json(),
    manifest = await Bun.file(`${base}/latest-effects/manifest.json`).json(),
    source = await Bun.file(
      `${base}/latest-effects/${manifest.definitions[ref.effectId].file}`,
    ).json();
  return {
    graph,
    emitter: source.definition.complexEmitterDefinitionData[ref.emitterIndex],
  };
}
function write(input, address, bytes, rootCopy = true) {
  const segment = input.graph.segments.find(
      (s) =>
        address >= s.address &&
        address + bytes.length <= s.address + s.bytesHex.length / 2,
    ),
    value = Uint8Array.fromHex(segment.bytesHex);
  value.set(bytes, address - segment.address);
  segment.bytesHex = value.toHex();
  if (
    rootCopy &&
    address >= 0x10020000 &&
    address + bytes.length <= 0x10020470
  ) {
    const object = Uint8Array.fromHex(input.graph.assetObjectHex);
    object.set(bytes, address - 0x10020000);
    input.graph.assetObjectHex = object.toHex();
  }
}
test("original quad source/constructor/read signatures retain exact consumed bytes", async () => {
  for (const kind of ["camera", "arbitrary"]) {
    const input = await fixture(kind),
      expected = derive(input);
    expect(expected.primitiveCode).toBe(kind === "camera" ? 0 : 1);
    expect(
      expected.rootReads.map((row) => [row.offset, row.bytesHex.length / 2]),
    ).toEqual([
      [0x11, 1],
      [0x14, 1],
      [0x72, 2],
      [0x75, 0x13],
      [0xc8, 1],
      [0x2d0, 4],
    ]);
    const changed = structuredClone(input);
    write(changed, 0x10020084, Uint8Array.of(0, 0, 0, 128));
    expect(derive(changed).rootReads).not.toEqual(expected.rootReads);
    const padding = structuredClone(input);
    write(padding, padding.graph.primitiveAddress + 9, Uint8Array.of(77));
    expect(derive(padding)).toEqual(expected);
    const reordered = structuredClone(input);
    reordered.graph.segments.reverse();
    expect(derive(reordered)).toEqual(expected);
  }
});
test("input signature rejects inconsistent roots, graph ownership and primitive sources", async () => {
  const input = await fixture("arbitrary");
  for (const mutate of [
    (x) => (x.graph.assetObjectHex = "00" + x.graph.assetObjectHex.slice(2)),
    (x) => x.graph.segments.pop(),
    (x) => (x.graph.segments[1].address = x.graph.segments[0].address),
    (x) => x.graph.assetHeapBytes++,
    (x) => x.graph.primitiveAddress++,
    (x) => write(x, x.graph.primitiveAddress + 8, Uint8Array.of(7)),
    (x) =>
      write(x, x.graph.primitiveAddress, Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0)),
    (x) => (x.emitter.primitive.extra = true),
    (x) => delete x.emitter.primitive,
    (x) => (x.emitter["{4b901db3}"] = null),
    (x) => write(x, 0x10020068, Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0)),
    (x) => write(x, 0x1002101c, Uint8Array.of(0, 0, 0, 0)),
    (x) => write(x, 0x10020030, Uint8Array.of(0, 0, 0, 0, 1, 0, 0, 0)),
  ]) {
    const changed = structuredClone(input);
    mutate(changed);
    expect(() => derive(changed)).toThrow();
  }
  let called = false;
  Object.defineProperty(input.graph, "assetObjectHex", {
    enumerable: true,
    get() {
      called = true;
      return "00";
    },
  });
  expect(() => derive(input)).toThrow();
  expect(called).toBe(false);
});
test("unprepared material definition absence is source-owned and cannot be forged by zero pointers", async () => {
  const input = await fixture("arbitrary");
  for (const [name, offset] of [
    ["alphaErosionDefinition", 0x38],
    ["paletteDefinition", 0x40],
    ["reflectionDefinition", 0x48],
  ]) {
    delete input.emitter[name];
    write(input, 0x10020000 + offset, new Uint8Array(8));
  }
  expect(() => basic(input)).not.toThrow();
  const hash = (name) => {
    let h = 0x811c9dc5;
    for (const b of new TextEncoder().encode(name.toLowerCase()))
      h = Math.imul(h ^ b, 0x1000193) >>> 0;
    return h.toString(16).padStart(8, "0");
  };
  for (const name of [
    "alphaErosionDefinition",
    "paletteDefinition",
    "reflectionDefinition",
  ]) {
    for (const key of [name, `{${hash(name)}}`]) {
      const changed = structuredClone(input);
      changed.emitter[key] = null;
      expect(() => basic(changed)).toThrow(
        "Unsupported authored material definition",
      );
    }
  }
  const changed = structuredClone(input);
  write(changed, 0x10020040, Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0));
  expect(() => basic(changed)).toThrow(
    "Absent authored material definition has a native pointer",
  );
});
